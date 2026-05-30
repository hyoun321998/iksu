export default {
  async fetch(request, env) {
    const allowed = env.ALLOWED_ORIGIN || 'https://iksu.org';

    const corsHeaders = {
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Bio ownership verification
    if (body.type === 'verify') {
      if (!body.slug || !body.code) {
        return new Response(JSON.stringify({ verified: false, reason: 'missing params' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const vSlug = body.slug.toLowerCase();
      const vRes = await fetch('https://kick.com/api/v2/channels/' + encodeURIComponent(vSlug), {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      });
      if (!vRes.ok) {
        return new Response(JSON.stringify({ verified: false, reason: 'channel_not_found' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const vChan = await vRes.json();
      const bio = (vChan.user && vChan.user.bio) ? vChan.user.bio : '';
      const verified = bio.indexOf(body.code) !== -1;
      return new Response(JSON.stringify({ verified: verified, bio_length: bio.length }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Channel lookup via public Kick API
    if (body.type === 'channel') {
      if (!body.slug) {
        return new Response(JSON.stringify({ error: 'slug required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const slug = body.slug.toLowerCase();
      let r;
      try {
        r = await fetch('https://kick.com/api/v2/channels/' + encodeURIComponent(slug), {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'fetch_failed', detail: e.message }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const text = await r.text();
      if (!r.ok) {
        return new Response(JSON.stringify({ error: 'kick_error', status: r.status, detail: text }), {
          status: r.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(text, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Token exchange
    if (!body.code || !body.code_verifier || !body.redirect_uri) {
      return new Response(JSON.stringify({ error: 'missing params' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const params = new URLSearchParams();
    params.set('grant_type', 'authorization_code');
    params.set('client_id', env.KICK_CLIENT_ID);
    params.set('client_secret', env.KICK_CLIENT_SECRET);
    params.set('redirect_uri', body.redirect_uri);
    params.set('code', body.code);
    params.set('code_verifier', body.code_verifier);

    const tokenRes = await fetch('https://id.kick.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return new Response(errText, {
        status: tokenRes.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tokenData = await tokenRes.json();

    const debug = {
      token_keys: Object.keys(tokenData),
      has_id_token: !!tokenData.id_token,
      scope_returned: tokenData.scope || null,
    };

    if (tokenData.access_token) {
      const browserUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
      let userId = null;
      let username = null;
      let profilePic = null;

      // Step 1: decode id_token or access_token as JWT
      const jwtSource = tokenData.id_token || tokenData.access_token;
      try {
        const parts = jwtSource.split('.');
        if (parts.length === 3) {
          const pad = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          const payload = JSON.parse(atob(pad));
          debug.jwt_step = 'decoded';
          debug.jwt_sub = payload.sub || null;
          debug.jwt_all_claims = Object.keys(payload);
          if (payload.sub) {
            userId = String(payload.sub);
            username = payload.preferred_username || payload.name || payload.username || null;
            profilePic = payload.picture || null;
          }
        } else {
          debug.jwt_step = 'not_jwt';
        }
      } catch (e) {
        debug.jwt_step = 'decode_error: ' + e.message;
      }

      // Step 2: fetch OIDC discovery doc to find the real userinfo endpoint
      let userinfoEndpoint = null;
      try {
        const discoveryRes = await fetch('https://id.kick.com/.well-known/openid-configuration', {
          headers: { 'Accept': 'application/json' },
        });
        if (discoveryRes.ok) {
          const discovery = await discoveryRes.json();
          debug.discovery_userinfo = discovery.userinfo_endpoint || null;
          debug.discovery_issuer   = discovery.issuer || null;
          userinfoEndpoint = discovery.userinfo_endpoint || null;
        } else {
          debug.discovery_status = discoveryRes.status;
        }
      } catch (e) {
        debug.discovery_error = e.message;
      }

      // Step 3: call userinfo endpoint (from discovery or known fallbacks)
      const userinfoTargets = [];
      if (userinfoEndpoint) userinfoTargets.push(userinfoEndpoint);
      userinfoTargets.push(
        'https://id.kick.com/userinfo',
        'https://id.kick.com/oauth/userinfo',
        'https://kick.com/api/v1/user',
        'https://kick.com/api/v2/user',
        'https://kick.com/api/v2/channels/me'
      );

      for (const endpoint of userinfoTargets) {
        if (username) break;
        try {
          const userRes = await fetch(endpoint, {
            headers: {
              'Authorization': 'Bearer ' + tokenData.access_token,
              'Client-Id': env.KICK_CLIENT_ID,
              'Accept': 'application/json',
              'User-Agent': browserUA,
            },
          });
          const userText = await userRes.text();
          debug.user_api_status   = (debug.user_api_status || '') + endpoint + ':' + userRes.status + ' ';
          debug.user_api_preview  = (debug.user_api_preview || '') + endpoint + ':' + userText.slice(0, 150) + ' | ';
          if (userRes.ok && userText.length > 2) {
            try {
              const userData = JSON.parse(userText);
              const uid   = userData.id   || userData.sub || (userData.user && userData.user.id);
              const uname = userData.username || userData.preferred_username || userData.name
                          || userData.slug || (userData.user && userData.user.username);
              if (uid || uname) {
                userId    = uid   ? String(uid) : null;
                username  = uname || null;
                profilePic = userData.profile_pic || userData.picture
                           || (userData.user && userData.user.profile_pic) || null;
              }
            } catch (e) {}
          }
        } catch (e) {
          debug.user_api_status = (debug.user_api_status || '') + endpoint + ':error ';
        }
      }

      // Step 3: use username to get full channel record
      if (username) {
        try {
          const slug = username.toLowerCase();
          const chanRes = await fetch('https://kick.com/api/v2/channels/' + encodeURIComponent(slug), {
            headers: { 'Accept': 'application/json', 'User-Agent': browserUA },
          });
          if (chanRes.ok) {
            const chan = await chanRes.json();
            tokenData.kick_profile = {
              id: userId || String((chan.user && chan.user.id) ? chan.user.id : chan.id || username),
              username: chan.slug || username,
              display_name: (chan.user && chan.user.username) ? chan.user.username : username,
              profile_pic: profilePic || ((chan.user && chan.user.profile_pic) ? chan.user.profile_pic : null),
              slug: chan.slug || username.toLowerCase(),
              followers_count: chan.followers_count || 0,
            };
          }
        } catch (e) {}
      }

      if (!tokenData.kick_profile && (userId || username)) {
        tokenData.kick_profile = {
          id: userId || username,
          username: username || userId,
          display_name: username || userId,
          profile_pic: profilePic || null,
          slug: (username || '').toLowerCase(),
          followers_count: 0,
        };
      }
    }

    tokenData._debug = debug;
    return new Response(JSON.stringify(tokenData), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  },
};
