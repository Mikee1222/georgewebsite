/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Disable webpack cache in dev only to avoid "Cannot find module './xxx.js'" after changes
  ...(process.env.NODE_ENV === 'development' && {
    webpack: (config, { dev }) => {
      if (dev) config.cache = false;
      return config;
    },
  }),
};

export default nextConfig;
