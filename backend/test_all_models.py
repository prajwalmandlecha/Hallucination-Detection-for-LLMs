import os
import asyncio
from httpx import AsyncClient
from google import genai

async def test_gemini():
    client = genai.Client()
    models = ['gemini-3-flash-preview', 'gemma-2-9b-it', 'gemma-2-27b-it', 'gemma-3-27b-it', 'gemma-4-31b-it']
    print('--- GEMINI ---')
    works = []
    for m in models:
        try:
            res = client.models.generate_content(model=m, contents='say hi')
            print(f'[SUCCESS] {m}: {res.text.strip()}')
            works.append(m)
        except Exception as e:
            err_msg = str(e).split('\n')[0]
            print(f'[FAIL] {m}: {err_msg}')
    return works

async def test_groq():
    print('--- GROQ ---')
    key = os.environ.get('GROQ_API_KEY')
    models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it', 'llama3-70b-8192', 'mixtral-8x7b-32768']
    works = []
    async with AsyncClient() as client:
        for m in models:
            try:
                res = await client.post('https://api.groq.com/openai/v1/chat/completions', 
                    headers={'Authorization': f'Bearer {key}'},
                    json={'model': m, 'messages': [{'role': 'user', 'content': 'hi'}], 'max_tokens': 5}
                )
                if res.status_code == 200:
                    print(f'[SUCCESS] {m}')
                    works.append(m)
                else:
                    print(f'[FAIL] {m}: {res.status_code} {res.text[:100]}')
            except Exception as e:
                print(f'[FAIL] {m}: {e}')
    return works

async def test_nvidia():
    print('--- NVIDIA NIM ---')
    key = os.environ.get('NVIDIA_API_KEY')
    models = ['meta/llama-3.1-70b-instruct', 'mistralai/mistral-7b-instruct-v0.3', 'nvidia/llama-3.1-nemotron-70b-instruct', 'google/gemma-2-9b-it']
    works = []
    async with AsyncClient() as client:
        for m in models:
            try:
                res = await client.post('https://integrate.api.nvidia.com/v1/chat/completions', 
                    headers={'Authorization': f'Bearer {key}', 'Accept': 'application/json'},
                    json={'model': m, 'messages': [{'role': 'user', 'content': 'hi'}], 'max_tokens': 5}
                )
                if res.status_code == 200:
                    print(f'[SUCCESS] {m}')
                    works.append(m)
                else:
                    print(f'[FAIL] {m}: {res.status_code} {res.text[:100]}')
            except Exception as e:
                print(f'[FAIL] {m}: {e}')
    return works

async def test_openrouter():
    print('--- OPENROUTER ---')
    key = os.environ.get('OPENROUTER_API_KEY')
    models = ['meta-llama/llama-3.3-70b-instruct:free', 'nvidia/llama-3.1-nemotron-70b-instruct:free', 'google/gemini-2.5-flash:free', 'deepseek/deepseek-r1:free', 'google/gemini-3-flash-preview:free']
    works = []
    async with AsyncClient() as client:
        for m in models:
            try:
                res = await client.post('https://openrouter.ai/api/v1/chat/completions', 
                    headers={'Authorization': f'Bearer {key}'},
                    json={'model': m, 'messages': [{'role': 'user', 'content': 'hi'}], 'max_tokens': 5}
                )
                if res.status_code == 200:
                    print(f'[SUCCESS] {m}')
                    works.append(m)
                else:
                    print(f'[FAIL] {m}: {res.status_code} {res.text[:100]}')
            except Exception as e:
                print(f'[FAIL] {m}: {e}')
    return works

async def main():
    w_gem = await test_gemini()
    w_groq = await test_groq()
    w_nv = await test_nvidia()
    w_op = await test_openrouter()
    with open('supported_apis.txt', 'w') as f:
        f.write(f"GEMINI={w_gem}\nGROQ={w_groq}\nNVIDIA={w_nv}\nOPENROUTER={w_op}")

asyncio.run(main())
