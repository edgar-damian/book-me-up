export type EstablishmentWorker = {
  id: string;
  slug: string;
  first_name: string;
  last_name: string;
  bio: string;
  image: string | null;
  is_active: boolean;
};

export type Establishment = {
  id: string;
  slug: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
  timezone: string;
  phone: string | null;
  email: string | null;
  hours: unknown | null;
  description: string;
  images: string[];
  is_active: boolean;
  workers: EstablishmentWorker[];
};