import { createClient } from '@supabase/supabase-js';

/* The one connection to the company archive. Imported ONLY from lazily
   loaded code (ArchiveView, fileToArchive) so the Supabase library never
   lands in the main bundle -- a superintendent filling out a JSA must not
   download or run any of this.

   The key here is the *publishable* key, which is built to ship in browser
   code: it names the project and grants nothing on its own. What actually
   protects the documents is the row-level security described in
   supabase/README.md. The master key is not in this repository. */

export const SUPABASE_URL = 'https://adqhuueugwbbudekpkiw.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_E3BmuEKyuqoJFT2z9enHLA_fABj2RB_';

export const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
