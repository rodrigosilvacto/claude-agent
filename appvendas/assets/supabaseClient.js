import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = "https://xtrvojnauvkkterogrst.supabase.co";
export const SUPABASE_KEY = "sb_publishable_JmhdMN8S7lSpCeaJANw_lQ_RRwZ2_OT";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
