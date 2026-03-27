# Express Upload Test Server

Temporary backend for testing ChatGPT attachment uploads from the extension.

## Run

```bash
cd /home/user/vsc/josh/temp/express-upload-test-server
npm install
npm start
```

The server starts on `http://127.0.0.1:5051`.

## Endpoints

- `GET /health`
- `POST /upload`

`POST /upload` expects multipart form data with the file in the `file` field. Uploaded files are saved into `uploads/`.
