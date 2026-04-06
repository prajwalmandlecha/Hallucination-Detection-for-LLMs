import os
import asyncio
from typing import List
from google import genai

async def test_working_models():
    api_key = None
    with open('.env', 'r') as f:
        for line in f:
            if line.startswith('GEMINI_API_KEY='):
                api_key = line.split('GEMINI_API_KEY=')[1].strip()
                break
    
    if not api_key:
        print("GEMINI_API_KEY not found in .env files.")
        return

    os.environ['GEMINI_API_KEY'] = api_key
    client = genai.Client(api_key=api_key)

    models_to_test = [
        "gemini-3-flash-preview",
        "gemini-3-pro-preview",
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-1.5-flash",
        "gemini-1.5-pro",
    ]

    print("Testing Gemini Models for `generateContent` availability...\n")
    for model_name in models_to_test:
        try:
            print(f"Testing model: {model_name}...")
            # We must specify `models/` prefix if we look at the list, or the string itself works usually.
            # Using bare name as standard:
            response = client.models.generate_content(
                model=model_name,
                contents="Say 'OK' if you can read this."
            )
            print(f"  [SUCCESS] {model_name} generated response: {response.text.strip()}\n")
        except Exception as e:
            print(f"  [FAILED] {model_name} is not available or errored out. Error: {e}\n")

if __name__ == "__main__":
    asyncio.run(test_working_models())
