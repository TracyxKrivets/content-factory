/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@supabase/supabase-js", "ffmpeg-static", "ffprobe-static", "archiver"],
};
export default nextConfig;
