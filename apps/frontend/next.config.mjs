/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable StrictMode to prevent double useEffect invocations in development.
  // React StrictMode intentionally mounts → unmounts → remounts every component
  // in dev, causing all API calls inside useEffect to fire twice.
  reactStrictMode: false,

  // Standalone output untuk Docker deployment yang lebih ringan.
  // Hanya menyertakan file yang benar-benar dibutuhkan di production.
  output: 'standalone',
};

export default nextConfig;
