// Versão exata pinada (em vez de "@2") para que uma release nova do
// supabase-js não entre em produção sem passar por um commit e revisão.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";

export const SUPABASE_URL = "https://xtrvojnauvkkterogrst.supabase.co";
export const SUPABASE_KEY = "sb_publishable_JmhdMN8S7lSpCeaJANw_lQ_RRwZ2_OT";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
