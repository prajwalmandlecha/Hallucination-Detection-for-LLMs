import os
import requests

def check_groq():
    key = os.environ.get('GROQ_API_KEY')
    if not key: return 'No key'
    res = requests.get('https://api.groq.com/openai/v1/models', headers={'Authorization': f'Bearer {key}'})
    if res.status_code == 200:
        return [m['id'] for m in res.json().get('data', [])]
    return f'Error {res.status_code}'

def check_nvidia():
    key = os.environ.get('NVIDIA_API_KEY')
    if not key: return 'No key'
    res = requests.get('https://integrate.api.nvidia.com/v1/models', headers={'Authorization': f'Bearer {key}'})
    if res.status_code == 200:
        return [m['id'] for m in res.json().get('data', [])]
    return f'Error {res.status_code}'

def check_openrouter():
    res = requests.get('https://openrouter.ai/api/v1/models')
    if res.status_code == 200:
        return [m['id'] for m in res.json().get('data', []) if m.get('pricing', {}).get('prompt') == '0']
    return f'Error {res.status_code}'

def check_gemini():
    key = os.environ.get('GEMINI_API_KEY')
    if not key: return 'No key'
    res = requests.get(f'https://generativelanguage.googleapis.com/v1beta/models?key={key}')
    if res.status_code == 200:
        return [m['name'] for m in res.json().get('models', [])]
    return f'Error {res.status_code}'

print('GROQ:', check_groq())
print('NVIDIA:', check_nvidia())
print('GEMINI:', check_gemini())
# OpenRouter list is long, let's just print a few key ones
openrouter_free = check_openrouter()
if isinstance(openrouter_free, list):
    print('OPENROUTER FREE:', [m for m in openrouter_free if 'llama' in m.lower() or 'gemma' in m.lower() or 'mistral' in m.lower()][:15])
else:
    print('OPENROUTER:', openrouter_free)

