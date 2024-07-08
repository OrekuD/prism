export type Session = {
  id: number;
  project_id: string;
  referrer: string;
  country_code: string;
  os: string;
  is_mobile: 0 | 1;
  browser: string;
  location: string;
  created_at: string;
};
