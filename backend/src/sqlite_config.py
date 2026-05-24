"""
SQLite 최적화 설정 모듈

Docker Compose / WSL 환경에서 SQLite의 동시성과 성능을 향상시키기 위한 
PRAGMA 설정을 제공합니다.

주요 설정:
- WAL (Write-Ahead Logging): 읽기/쓰기 동시 허용, 락 최소화
- Busy Timeout: DB 잠금 시 대기 후 재시도
- Synchronous NORMAL: WAL 모드에서 성능/안전성 균형
- Cache Size: 메모리 캐시 크기 설정
"""

import sqlite3
import logging
import os
from typing import Optional

logger = logging.getLogger("diff-lens.sqlite")


# =============================================================================
# 설정 상수
# =============================================================================

class SQLiteConfig:
    """SQLite 최적화 설정 값들"""
    
    # WAL 모드: 읽기/쓰기 동시 허용 (가장 중요)
    # Docker Desktop/Windows bind mount에서는 WAL sidecar 파일이 disk I/O error를
    # 일으킬 수 있어 compose에서 DELETE로 낮출 수 있게 둔다.
    JOURNAL_MODE = os.environ.get("SQLITE_JOURNAL_MODE", "WAL").upper()
    
    # Busy Timeout: DB 잠금 시 대기 시간 (밀리초)
    # 5000ms = 5초 동안 재시도
    BUSY_TIMEOUT_MS = 5000
    
    # Synchronous 모드: NORMAL은 WAL에서 최적의 성능/안전성 균형
    # OFF: 가장 빠르지만 데이터 손실 위험
    # NORMAL: WAL 모드에서 권장 (체크포인트 시에만 동기화)
    # FULL: 가장 안전하지만 느림
    SYNCHRONOUS = "NORMAL"
    
    # 캐시 크기: 음수값은 KB 단위 (64000KB = 64MB)
    CACHE_SIZE_KB = -64000
    
    # 메모리 매핑 크기: 128MB (대용량 DB에서 성능 향상)
    MMAP_SIZE_BYTES = int(os.environ.get("SQLITE_MMAP_SIZE", "134217728"))  # 128 * 1024 * 1024


# =============================================================================
# SQLAlchemy 이벤트 리스너
# =============================================================================

def configure_sqlite_engine(engine):
    """
    SQLAlchemy Engine에 SQLite 최적화 PRAGMA 설정을 적용합니다.
    
    사용법:
        from sqlmodel import create_engine
        from .sqlite_config import configure_sqlite_engine
        
        engine = create_engine(DATABASE_URL, ...)
        configure_sqlite_engine(engine)
    
    Args:
        engine: SQLAlchemy Engine 객체
    """
    from sqlalchemy import event
    
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_conn, connection_record):
        """SQLite 연결 시 최적화 PRAGMA 설정"""
        cursor = dbapi_conn.cursor()
        try:
            # 1. 저널 모드 설정 (로컬 기본 WAL, Docker bind mount에서는 DELETE 권장)
            cursor.execute(f"PRAGMA journal_mode = {SQLiteConfig.JOURNAL_MODE};")
            
            # 2. Busy Timeout 설정 (락 충돌 시 대기)
            cursor.execute(f"PRAGMA busy_timeout = {SQLiteConfig.BUSY_TIMEOUT_MS};")
            
            # 3. Synchronous 모드 (WAL에서 성능 최적화)
            cursor.execute(f"PRAGMA synchronous = {SQLiteConfig.SYNCHRONOUS};")
            
            # 4. 캐시 크기 설정
            cursor.execute(f"PRAGMA cache_size = {SQLiteConfig.CACHE_SIZE_KB};")
            
            # 5. 메모리 매핑 활성화 (선택적 - bind mount에서는 0으로 끌 수 있음)
            if SQLiteConfig.MMAP_SIZE_BYTES > 0:
                cursor.execute(f"PRAGMA mmap_size = {SQLiteConfig.MMAP_SIZE_BYTES};")
            
            logger.debug(
                f"SQLite PRAGMA 설정 적용 완료: "
                f"journal_mode={SQLiteConfig.JOURNAL_MODE}, "
                f"busy_timeout={SQLiteConfig.BUSY_TIMEOUT_MS}ms, "
                f"synchronous={SQLiteConfig.SYNCHRONOUS}"
            )
        except Exception as e:
            logger.warning(f"SQLite PRAGMA 설정 실패: {e}")
        finally:
            cursor.close()
    
    logger.info("✓ SQLite 최적화 이벤트 리스너 등록 완료")


# =============================================================================
# 직접 sqlite3 연결용 유틸리티
# =============================================================================

def get_optimized_connection(db_path: str, isolation_level: Optional[str] = None) -> sqlite3.Connection:
    """
    최적화된 SQLite 연결을 반환합니다.
    
    사용법:
        from .sqlite_config import get_optimized_connection
        
        conn = get_optimized_connection("my_database.db")
        # 또는 수동 트랜잭션 제어를 위해
        conn = get_optimized_connection("my_database.db", isolation_level=None)
    
    Args:
        db_path: 데이터베이스 파일 경로
        isolation_level: 트랜잭션 격리 수준 (None = 자동 커밋/수동 제어)
    
    Returns:
        최적화된 sqlite3.Connection 객체
    """
    conn = sqlite3.connect(db_path, isolation_level=isolation_level)
    
    # 최적화 PRAGMA 적용
    conn.execute(f"PRAGMA journal_mode = {SQLiteConfig.JOURNAL_MODE};")
    conn.execute(f"PRAGMA busy_timeout = {SQLiteConfig.BUSY_TIMEOUT_MS};")
    conn.execute(f"PRAGMA synchronous = {SQLiteConfig.SYNCHRONOUS};")
    conn.execute(f"PRAGMA cache_size = {SQLiteConfig.CACHE_SIZE_KB};")
    if SQLiteConfig.MMAP_SIZE_BYTES > 0:
        conn.execute(f"PRAGMA mmap_size = {SQLiteConfig.MMAP_SIZE_BYTES};")
    
    logger.debug(f"최적화된 SQLite 연결 생성: {db_path}")
    return conn


def perform_immediate_transaction(conn: sqlite3.Connection, statements: list):
    """
    IMMEDIATE 트랜잭션을 사용하여 여러 SQL 문을 실행합니다.
    락 충돌을 최소화하기 위해 트랜잭션 시작 시점에 쓰기 의도를 선언합니다.
    
    사용법:
        statements = [
            ("INSERT INTO my_table (name) VALUES (?)", ("value1",)),
            ("UPDATE my_table SET name = ? WHERE id = ?", ("value2", 1)),
        ]
        perform_immediate_transaction(conn, statements)
    
    Args:
        conn: sqlite3.Connection 객체
        statements: (SQL, params) 튜플의 리스트
    
    Raises:
        Exception: 트랜잭션 실패 시 (자동 롤백됨)
    """
    try:
        conn.execute("BEGIN IMMEDIATE")
        for sql, params in statements:
            conn.execute(sql, params)
        conn.execute("COMMIT")
        logger.debug(f"IMMEDIATE 트랜잭션 성공: {len(statements)}개 문 실행")
    except Exception as e:
        conn.execute("ROLLBACK")
        logger.error(f"IMMEDIATE 트랜잭션 롤백: {e}")
        raise


# =============================================================================
# 진단/정보 유틸리티
# =============================================================================

def get_sqlite_info(conn: sqlite3.Connection) -> dict:
    """
    현재 SQLite 연결의 PRAGMA 설정 정보를 반환합니다.
    디버깅 및 검증용.
    """
    pragmas = [
        "journal_mode",
        "busy_timeout", 
        "synchronous",
        "cache_size",
        "mmap_size",
        "wal_autocheckpoint"
    ]
    
    info = {}
    cursor = conn.cursor()
    for pragma in pragmas:
        try:
            cursor.execute(f"PRAGMA {pragma};")
            result = cursor.fetchone()
            info[pragma] = result[0] if result else None
        except Exception:
            info[pragma] = "N/A"
    cursor.close()
    
    return info
