export const BACKEND_PORT = import.meta.env.VITE_BACKEND_PORT || "8000";
export const API_BASE_URL = `http://${window.location.hostname}:${BACKEND_PORT}/api`;
