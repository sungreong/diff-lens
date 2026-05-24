import requests
import sys
import time

BASE_URL = "http://localhost:8000"

def wait_for_server():
    print("Waiting for server to be ready...", end="", flush=True)
    for _ in range(30):
        try:
            r = requests.get(f"{BASE_URL}/health", timeout=1)
            if r.status_code == 200:
                print(" OK!")
                return True
        except:
            pass
        print(".", end="", flush=True)
        time.sleep(1)
    print(" server not responding.")
    return False

def test_crud():
    if not wait_for_server():
        return

    # 1. Create Profile
    print("\n[TEST] Creating Profile...")
    profile_data = {"name": "CRUD Test Profile", "description": "Automated verification"}
    r = requests.post(f"{BASE_URL}/profiles", json=profile_data)
    if r.status_code != 200:
        print(f"FAIL: Could not create profile. {r.status_code} {r.text}")
        return
    profile = r.json()
    p_id = profile['id']
    print(f"SUCCESS: Created Profile ID {p_id}")

    # 2. Get Profile List
    print("\n[TEST] Listing Profiles...")
    r = requests.get(f"{BASE_URL}/profiles")
    if r.status_code != 200:
        print(f"FAIL: Could not list profiles. {r.status_code}")
    else:
        profiles = r.json()
        print(f"SUCCESS: Found {len(profiles)} profiles.")
        if not any(p['id'] == p_id for p in profiles):
            print("FAIL: Created profile not in list!")

    # 3. Create Repo
    print("\n[TEST] Creating Repository for Profile...")
    repo_data = {
        "name": "Test Repo",
        "git_url": "https://gitlab.com/example/test",
        "git_token": "dummy-token",
        "project_id": "1001"
    }
    r = requests.post(f"{BASE_URL}/profiles/{p_id}/repos", json=repo_data)
    if r.status_code != 200:
        print(f"FAIL: Could not create repo. {r.status_code} {r.text}")
    else:
        repo = r.json()
        r_id = repo['id']
        print(f"SUCCESS: Created Repo ID {r_id}")

        # 4. Update Repo
        print("\n[TEST] Updating Repository...")
        update_data = {"name": "Test Repo Updated"}
        r = requests.put(f"{BASE_URL}/repos/{r_id}", json=update_data)
        if r.status_code != 200:
            print(f"FAIL: Could not update repo. {r.status_code} {r.text}")
        else:
            updated_repo = r.json()
            if updated_repo['name'] == "Test Repo Updated":
                print("SUCCESS: Repo name updated.")
            else:
                print("FAIL: Repo name mismatch after update.")

        # 5. Delete Repo
        print("\n[TEST] Deleting Repository...")
        r = requests.delete(f"{BASE_URL}/repos/{r_id}")
        if r.status_code == 200:
            print("SUCCESS: Repo deleted.")
        else:
            print(f"FAIL: Could not delete repo. {r.status_code}")

    # 6. Delete Profile
    print("\n[TEST] Deleting Profile...")
    r = requests.delete(f"{BASE_URL}/profiles/{p_id}")
    if r.status_code == 200:
        print("SUCCESS: Profile deleted.")
    else:
        print(f"FAIL: Could not delete profile. {r.status_code}")

if __name__ == "__main__":
    test_crud()
