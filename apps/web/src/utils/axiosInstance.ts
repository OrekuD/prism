import { LocalStorageKeys } from "@/constants/LocalStorageKeys";
import axios from "axios";

export const axiosInstance = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL}/api/v1`,
  headers: {
    "Content-Type": "application/json",
  },
});

// Read the access token on every request so that signing in does not require
// a page reload for the Authorization header to appear.
axiosInstance.interceptors.request.use((config) => {
  const accessToken = localStorage.getItem(LocalStorageKeys.TOKEN);

  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }

  return config;
});
