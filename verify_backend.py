
import os
import sys
from unittest.mock import MagicMock, patch

# Add backend directory to sys.path
sys.path.append(os.path.abspath("backend"))

from src.git_client import GitLabClient
from src.models import GitCredentials

# Mocking GitLab library parts to avoid actual network calls and credential issues for this test
# We just want to verify the pagination logic in fetch_commits

def test_fetch_commits_logic():
    print("Testing fetch_commits logic...")
    
    # Mocking the client and project
    client = GitLabClient("https://gitlab.example.com", "token")
    mock_project = MagicMock()
    client.get_project = MagicMock(return_value=mock_project)
    
    # Mock return values for commits
    # Create 150 mock commits
    mock_commits = [MagicMock(id=str(i), short_id=str(i)[:8], title=f"Commit {i}", author_name="Tester", author_email="test@example.com", created_at="2023-01-01") for i in range(150)]
    
    # Configure the mock to return an iterator
    mock_project.commits.list.return_value = iter(mock_commits)
    
    # Test 1: Fetch with default limit (100)
    print("\nTest 1: Fetch with limit=100")
    results = client.fetch_commits("123", limit=100)
    print(f"Fetched {len(results)} commits")
    if len(results) == 100:
        print("PASS: Limit of 100 respected")
    else:
        print(f"FAIL: Expected 100, got {len(results)}")
        
    # Test 2: Fetch with limit=50
    print("\nTest 2: Fetch with limit=50")
    # Reset iterator
    mock_project.commits.list.return_value = iter(mock_commits)
    results = client.fetch_commits("123", limit=50)
    print(f"Fetched {len(results)} commits")
    if len(results) == 50:
        print("PASS: Limit of 50 respected")
    else:
        print(f"FAIL: Expected 50, got {len(results)}")

    # Test 3: Fetch with limit=120
    print("\nTest 3: Fetch with limit=120")
    # Reset iterator
    mock_project.commits.list.return_value = iter(mock_commits)
    results = client.fetch_commits("123", limit=120)
    print(f"Fetched {len(results)} commits")
    if len(results) == 120:
        print("PASS: Limit of 120 respected")
    else:
        print(f"FAIL: Expected 120, got {len(results)}")

    # Test 4: Verify paginated calls arguments
    # We want to ensure it passes iterator=True and per_page <= 100
    mock_project.commits.list.reset_mock()
    client.fetch_commits("123", limit=150)
    call_kwargs = mock_project.commits.list.call_args[1]
    print("\nTest 4: Verify API call arguments")
    print(f"Call kwargs: {call_kwargs}")
    if call_kwargs.get('iterator') is True and call_kwargs.get('per_page') == 100:
        print("PASS: Correct arguments for pagination")
    else:
        print("FAIL: Incorrect arguments for pagination")

if __name__ == "__main__":
    test_fetch_commits_logic()
