import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
};

function jsonResponse(status: number, body: Record<string, unknown>) {
    return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (request: Request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' });

    const authorization = request.headers.get('Authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const oneSignalApiKey = Deno.env.get('ONESIGNAL_REST_API_KEY');
    const accessToken = authorization?.replace(/^Bearer\s+/i, '');
    if (!accessToken) return jsonResponse(401, { error: 'Authentication required.' });
    if (!supabaseUrl || !supabaseAnonKey || !oneSignalApiKey) {
        return jsonResponse(500, { error: 'Server configuration is incomplete.' });
    }

    try {
        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: `Bearer ${accessToken}` } }
        });
        const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);
        if (userError || !user) return jsonResponse(401, { error: 'Authentication required.' });

        const isAdmin = user.email?.toLowerCase() === 'admin@ubipet.com'
            || user.app_metadata?.role === 'admin';
        if (!isAdmin) return jsonResponse(403, { error: 'Only Super Admin can send global pushes.' });

        const payload = await request.json();
        const message = typeof payload.message === 'string' ? payload.message.trim() : '';
        if (!message || message.length > 1000) {
            return jsonResponse(400, { error: 'Message must contain 1 to 1000 characters.' });
        }

        const oneSignalResponse = await fetch('https://onesignal.com/api/v1/notifications', {
            method: 'POST',
            headers: {
                accept: 'application/json',
                Authorization: `Key ${oneSignalApiKey}`,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                app_id: 'ab26f7b2-3ba8-4125-a259-7b0cb181d9fb',
                included_segments: ['Subscribed Users'],
                headings: { es: 'Alerta UbiPet 🐾', en: 'Alerta UbiPet 🐾' },
                contents: { es: message, en: message }
            })
        });
        const oneSignalBody = await oneSignalResponse.text();

        if (!oneSignalResponse.ok) {
            const details = oneSignalBody || 'OneSignal rejected the notification request.';
            console.error('[UbiPet] OneSignal API rejected the request:', oneSignalResponse.status, details);
            return jsonResponse(502, { error: `OneSignal returned ${oneSignalResponse.status}.`, details });
        }
        let oneSignalResult: { id?: string } | null = null;
        try {
            oneSignalResult = JSON.parse(oneSignalBody);
        } catch {
            oneSignalResult = null;
        }
        return jsonResponse(200, { success: true, id: oneSignalResult?.id || null });
    } catch (error) {
        console.error('[UbiPet] Global push request failed:', error);
        return jsonResponse(500, { error: 'Unable to send global push notification.' });
    }
});
