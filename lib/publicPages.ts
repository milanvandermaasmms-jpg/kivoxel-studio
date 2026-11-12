/** Public pages without login: only the homepage and privacy statement of Kivoxel Studio (needed by Google OAuth). */
export const isPublicPath = (path: string | null) => path === "/kivoxel" || (path?.startsWith("/kivoxel/") ?? false);
