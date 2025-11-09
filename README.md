Test Live v2 - SPA (Full-screen live + slide-up chat) - Render-ready
------------------------------------------------------------------

Files:
- server.js (backend, moderation)
- frontend/index.html (SPA single page)
- Dockerfile (build image)
- render.yaml (Render blueprint)
- .env.example (set JWT_SECRET and ADMIN_KEY)

Quick deploy on Render:
1. Push repository to GitHub.
2. On Render create new Web Service or import using render.yaml.
3. Set environment variables: JWT_SECRET, ADMIN_KEY.
4. Deploy. First build may take several minutes due to TensorFlow native deps.

Local test (docker):
cp .env.example .env
# edit .env
docker build -t testlivev2 .
docker run -p 3000:3000 --env-file .env testlivev2
Open http://localhost:3000
