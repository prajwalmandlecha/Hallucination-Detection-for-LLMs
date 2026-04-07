import requests
import json
import time

API_URL = "http://localhost:8000/api/v1"

def test_detect_endpoint():
    """Test the main /detect endpoint for hallucination detection."""
    print("Testing /api/v1/detect endpoint...")
    
    payload = {
        "model_response": "The capital of France is Paris. Also, Bitcoin was created by Steve Jobs in 2005.",
        "conversation_history": [
            {
                "role": "user",
                "content": "Tell me a fact about France and Bitcoin."
            }
        ],
        "config": {
            "check_web": True,
            "check_documents": False,
            "check_conversation": False
        }
    }
    
    start_time = time.time()
    try:
        response = requests.post(f"{API_URL}/detect", json=payload)
        response.raise_for_status()
        
        data = response.json()
        took = time.time() - start_time
        
        print(f"✅ Success! (took {took:.2f}s)")
        print(f"Risk Level: {data.get('risk_level')} (Score: {data.get('overall_risk_score')})")
        
        claims = data.get('claims', [])
        print(f"\nExtracted Claims ({len(claims)}):")
        for i, claim in enumerate(claims):
            print(f"  {i+1}. {claim.get('text')}")
            print(f"     Status: {claim.get('status')}")
            reason = claim.get('reasoning')
            if reason:
                print(f"     Reasoning: {reason}")
            
    except requests.exceptions.ConnectionError:
        print("❌ Error: Could not connect to the server.")
        print("Make sure Uvicorn is running: uvicorn app.main:app --reload")
    except requests.exceptions.HTTPError as e:
        print(f"❌ HTTP Error: {e}")
        print("Response:", response.text)
    except Exception as e:
        print(f"❌ Unexpected error: {e}")

if __name__ == "__main__":
    test_detect_endpoint()
