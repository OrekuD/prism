import { LocalStorageKeys } from "@/constants/LocalStorageKeys";
import axios from "axios";

const accessToken = localStorage.getItem(LocalStorageKeys.TOKEN);

export const axiosInstance = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL}/api/v1`,
  headers: {
    "Content-Type": "application/json",
    Authorization: accessToken ? `Bearer ${accessToken}` : undefined,
  },
});
