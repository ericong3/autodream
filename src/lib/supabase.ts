import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ayvbagxashasdqgwncbf.supabase.co';
const supabaseKey = 'sb_publishable_4tTvqdEdYgocC4OaFCq2WQ_OajRZzOe';

export const supabase = createClient(supabaseUrl, supabaseKey);
