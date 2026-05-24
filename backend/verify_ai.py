import requests
import os
import sys

BASE_URL = "http://localhost:8000"

# .env에서 값을 읽어오지 않고, API를 통해 테스트합니다.
# 실제로는 .env가 컨테이너에 마운트되어 있으므로, 
# 테스트 호출 시에는 더미 데이터나 실제 설정값이 필요할 수 있습니다.
# 하지만 /test/openai 엔드포인트는 body로 키를 받으므로, 
# 여기서는 환경변수나 하드코딩된 값을 보내야 합니다.
# 사용자의 .env 파일을 직접 읽을 수는 없으므로(보안), 
# 일단 더미 값으로 호출하여 "연결 실패" 메시지가 나오는지(즉 엔드포인트가 살아있는지),
# 아니면 500 에러가 나는지를 확인하는 것이 1차적 목표입니다.
# 만약 사용자가 .env에 키를 넣었다면, 이 스크립트를 조금 수정하여 그것을 로드하게 해야 할 수도 있습니다.
# 하지만 여기서는 "엔드포인트 동작 여부"를 먼저 봅니다.

def test_ai_connection():
    print("Testing OpenAI Endpoint...")
    
    # 1. Test OpenAI (Expecting failure due to dummy key, but 200 OK + success=False)
    payload = {
        "openai_api_key": "dummy-openai-key-for-testing",
        "openai_base_url": "https://api.openai.com/v1",
        "openai_model": "gpt-4o-mini"
    }
    try:
        r = requests.post(f"{BASE_URL}/test/openai", json=payload)
        if r.status_code == 200:
            result = r.json()
            print(f"Result: {result}")
            if result['success']:
                print("SUCCESS: OpenAI Connected!")
            else:
                print(f"EXPECTED FAILURE (Auth): {result['message']}")
        else:
            print(f"FAIL: Status Code {r.status_code}")
            print(r.text)
    except Exception as e:
        print(f"FAIL: Connection Error - {e}")

    print("\nTesting Langfuse Endpoint...")
    # 2. Test Langfuse
    payload_lf = {
        "public_key": "pk-lf-dummy",
        "secret_key": "dummy-langfuse-secret",
        "host": "https://cloud.langfuse.com"
    }
    try:
        r = requests.post(f"{BASE_URL}/test/langfuse", json=payload_lf)
        if r.status_code == 200:
            result = r.json()
            print(f"Result: {result}")
            if result['success']:
                print("SUCCESS: Langfuse Connected!")
            else:
                print(f"EXPECTED FAILURE (Auth): {result['message']}")
        else:
            print(f"FAIL: Status Code {r.status_code}")
            print(r.text)
    except Exception as e:
        print(f"FAIL: Connection Error - {e}")

if __name__ == "__main__":
    test_ai_connection()
