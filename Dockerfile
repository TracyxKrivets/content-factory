# Runs the app + background worker + ffmpeg in one container.
# Works on Railway, Render, Fly.io, a VPS, etc. (Vercel can't run ffmpeg or long jobs.)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fontconfig fonts-dejavu-core fonts-freefont-ttf \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=3000 CAPTION_FONT="DejaVu Sans"
COPY --from=build /app ./
EXPOSE 3000
# Mount a volume at /app/data if you are not using Supabase, so projects survive redeploys.
CMD ["npm", "start", "--", "-p", "3000"]
