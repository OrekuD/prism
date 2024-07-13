export type Session = {
  id: number;
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
  created_at: string;
};
