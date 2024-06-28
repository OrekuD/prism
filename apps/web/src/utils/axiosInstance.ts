import { LocalStorageKeys } from "@/constants/LocalStorageKeys";
import axios from "axios";

const accessToken = localStorage.getItem(LocalStorageKeys.AUTHENTICATION) || "";

export const axiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL + "/api/v1",
  // withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    Authorization: accessToken ? `Bearer ${accessToken}` : undefined,
  },
});
