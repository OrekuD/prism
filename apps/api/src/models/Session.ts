export type Session = {
  id: number;
  session_id: string;
  project_id: string;
  referrer: string;
  country_code: string;
  os: string;
  browser: string;
  location: string;
  is_mobile: 0 | 1;
  ip: string;
  long: string;
  lat: string;
  is_online: 0 | 1;
  created_at: string;
};
