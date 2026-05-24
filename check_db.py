import sqlite3
import os

DB_PATH = 'backend/storage.db'

def check_db():
    if not os.path.exists(DB_PATH):
        print("Database not found.")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    print("--- Profiles ---")
    try:
        cursor.execute("SELECT id, name, is_active FROM profile")
        profiles = cursor.fetchall()
        for p in profiles:
            print(p)
    except Exception as e:
        print(f"Error reading profiles: {e}")

    print("\n--- LLM Configs ---")
    try:
        cursor.execute("SELECT id, profile_id, name, is_active FROM llmconfig")
        llms = cursor.fetchall()
        for l in llms:
            print(l)
    except Exception as e:
        print(f"Error reading llmconfig: {e}")

    conn.close()

if __name__ == "__main__":
    check_db()
