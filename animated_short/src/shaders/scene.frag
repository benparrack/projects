#version 330
// LANTERN — main scene shader. Output: linear HDR radiance.
// All positions come in pre-transformed per-object frames (see src/scene.py).
out vec4 fragColor;

uniform vec2  uRes;
uniform vec2  uJitter;
uniform float uTime;        // global film time (s), for procedural motion
uniform mat3  uCam;         // world-space camera basis: right, up, forward
uniform float uTanHalf;     // tan(vertical fov / 2)
uniform int   uMode;        // 0 space, 1 tunnel, 2 other side (vista)
uniform float uExposure;

// ---- sun / sky
uniform vec3  uSunDir;
uniform vec3  uSunCol;
uniform float uStarI;
uniform float uNebI;

// ---- planet (frame: planet radii, planet-local rotation)
uniform float uPlOn;
uniform vec3  uPlRo;        // camera position in planet frame (radii)
uniform mat3  uPlRot;       // world -> planet
uniform float uPlR;         // radius km
uniform float uPlLight;     // night-side lightning amount

// ---- gate ring (frame: km, anchored so the camera azimuth is 0, ring radius subtracted)
uniform float uRgOn;
uniform vec3  uRgRo;
uniform mat3  uRgRot;       // world -> anchored ring frame
uniform float uRgR;         // ring radius (km) to floor centre-line of the body
uniform float uRgAnchor;    // anchor angle (rad)
uniform float uRgUOff;      // arc-length offset of anchor, mod pattern period (km)
uniform float uRgDetail;    // 0..1 greeble detail allowed
uniform float uRgShadow;    // soft self-shadows on/off
uniform float uBeaconAng;   // angle of the answering beacon (rad)
uniform float uBeacon;      // beacon light intensity
uniform float uCascade;     // cascade front, radians of arc lit on each side of the beacon
uniform float uRgPower;     // overall power-up glow 0..1+
uniform float uFilaments;   // inward energy filaments 0..1
uniform float uCoreGlow;    // centre point glow
uniform float uPortal;      // portal radius as fraction of inner radius 0..1
uniform float uRipple;      // space ripple amount
uniform float uShockR;      // shockwave radius km (0 = none)
uniform float uShockI;

// ---- probe (frame: metres, probe-local)
uniform float uPbOn;
uniform vec3  uPbRo;        // camera pos in probe frame (probe units)
uniform mat3  uPbRot;       // world -> probe
uniform float uPbScale;     // km per probe unit
uniform float uPbCore;      // core light intensity (1 healthy)
uniform vec3  uPbPosW;      // probe position relative to camera, world km
uniform float uPbGlowSize;  // glow scale multiplier (for distant shots)
uniform vec3  uPbLightRg;   // probe position in anchored ring frame (km)
uniform float uPbSun;       // sun visibility at the probe

// ---- pings: xyz = centre rel camera (km), w = radius (km); intensity / colour kind
uniform vec4  uPing[6];
uniform vec4  uPingP[6];    // x intensity, y shell thickness (km), z kind (0 amber, 1 blue, 2 white)

// ---- vista (other side)
uniform vec3  uVCoreDir;    // direction of galactic core (world)
uniform float uVistaI;
uniform float uSwarm;       // time since swarm activation (s), <0 = off
uniform vec3  uSwC;         // swarm centre rel camera (km)
uniform float uSwFar;       // far-lantern layer amount
// ---- tunnel
uniform float uTunT;        // tunnel progress 0..1
uniform float uFlash;       // additive white flash

const float PI = 3.14159265359;

// ------------------------------------------------------------ noise
float hash11(float p){ p = fract(p*.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec3  hash33(vec3 p3){ p3 = fract(p3*vec3(.1031,.1030,.0973)); p3 += dot(p3, p3.yxz+33.33); return fract((p3.xxy+p3.yxx)*p3.zyx); }
float hash31(vec3 p3){ p3 = fract(p3*.1031); p3 += dot(p3, p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }

float vnoise(vec3 p){
    vec3 i = floor(p), f = fract(p);
    vec3 u = f*f*(3.-2.*f);
    return mix(mix(mix(hash31(i+vec3(0,0,0)),hash31(i+vec3(1,0,0)),u.x),
                   mix(hash31(i+vec3(0,1,0)),hash31(i+vec3(1,1,0)),u.x),u.y),
               mix(mix(hash31(i+vec3(0,0,1)),hash31(i+vec3(1,0,1)),u.x),
                   mix(hash31(i+vec3(0,1,1)),hash31(i+vec3(1,1,1)),u.x),u.y),u.z);
}
float fbm(vec3 p, int oct){
    float a = .5, s = 0.;
    for(int i=0;i<8;i++){ if(i>=oct) break; s += a*vnoise(p); p = p*2.03 + vec3(1.7,9.2,3.1); a *= .5; }
    return s;
}
vec2 rot2(vec2 v, float a){ float c=cos(a), s=sin(a); return vec2(c*v.x-s*v.y, s*v.x+c*v.y); }

// ------------------------------------------------------------ sky
float gPix; // angular pixel size

vec3 starLayer(vec3 rd, float scale, float density, float seed){
    vec3 p = rd*scale;
    vec3 c = floor(p);
    vec3 h = hash33(c+seed);
    if(h.x > density) return vec3(0);
    vec3 sp = normalize(c + .25 + .5*hash33(c+seed+7.));
    float d = length(rd - sp);                       // ~ angular distance
    float w = max(gPix*.9, 1e-5);
    float b = pow(hash11(h.y*91.+seed), 8.)*4. + .04;
    float temp = h.z;
    vec3 col = mix(vec3(1.,.72,.5), vec3(.65,.8,1.), temp);
    col = mix(col, vec3(1.), .4);
    float tw = 1.;
    float ref = .0006;
    return col * b * exp(-d*d/(w*w)) * min(1., (ref*ref)/(w*w)) * tw;
}

vec3 stars(vec3 rd){
    vec3 s = vec3(0);
    s += starLayer(rd, 60., .10, 1.)*1.6;
    s += starLayer(rd, 140., .07, 2.);
    s += starLayer(rd, 300., .05, 3.)*.6;
    return s;
}

// milky band + nebula of home space (cool, dim)
vec3 homeNebula(vec3 rd){
    vec3 bandN = normalize(vec3(.3, 1., .2));
    float b = dot(rd, bandN);
    float band = exp(-b*b*9.);
    float n = fbm(rd*3.+vec3(3.1), 5);
    float n2 = fbm(rd*7.-vec3(1.3), 4);
    vec3 col = vec3(0);
    col += band * (.35+.65*n) * mix(vec3(.10,.13,.22), vec3(.28,.20,.30), n2) ;
    // dust lanes
    col *= 1. - .7*band*smoothstep(.45,.7,fbm(rd*11.,4));
    // a warm distant emission cloud
    float cl = smoothstep(.5,.9, fbm(rd*2.2+vec3(8.,1.,2.),5)) * smoothstep(-.2,.6,dot(rd, normalize(vec3(-.6,.2,.8))));
    col += cl * vec3(.30,.10,.12);
    return col;
}

vec3 sunLight(vec3 rd){
    float c = dot(rd, uSunDir);
    float ang = acos(clamp(c,-1.,1.));
    float disk = smoothstep(.0048, .0040, ang);
    vec3 s = uSunCol * disk * 60.;
    s += uSunCol * (exp(-ang*55.)*1.2 + exp(-ang*9.)*.06);
    return s;
}

// the "other side": a luminous galactic core + rich nebula
vec3 vistaSky(vec3 rd){
    vec3 cd = normalize(uVCoreDir);
    float c = dot(rd, cd);
    // build a frame around the core direction
    vec3 up = normalize(vec3(.15,1.,.05));
    vec3 xa = normalize(cross(up, cd)), ya = cross(cd, xa);
    vec2 q = vec2(dot(rd,xa), dot(rd,ya)) / max(c, .05);
    // tilted galaxy disc
    vec2 g = vec2(q.x, q.y*2.6 - q.x*.25);
    float r = length(g);
    float ang = atan(g.y, g.x);
    float arms = .5+.5*sin(ang*2. - log(r+.02)*5.5 + 1.);
    float disc = exp(-r*3.2) * (.35 + .9*arms*smoothstep(.02,.4,r));
    float dust = smoothstep(.35,.75, fbm(vec3(g*6., 1.), 5));
    disc *= 1. - .55*dust*smoothstep(.03,.25,r);
    float bulge = exp(-r*r*55.)*6. + exp(-r*9.)*1.3;
    vec3 col = vec3(0);
    float front = smoothstep(-.1, .3, c);
    col += front * (disc*vec3(1.,.72,.45)*.55 + bulge*vec3(1.,.85,.62)*.6);
    // nebula veils everywhere (colourful)
    float n1 = fbm(rd*2.5 + vec3(2.), 6);
    float n2 = fbm(rd*5.1 - vec3(4.), 5);
    float n3 = fbm(rd*1.3 + vec3(n1*2.), 4);
    vec3 neb = mix(vec3(.10,.26,.34), vec3(.34,.16,.30), smoothstep(.3,.7,n2));
    neb = mix(neb, vec3(.7,.42,.2), smoothstep(.55,.8,n3)*.6);
    col += neb * pow(smoothstep(.4,.9,n1),1.8) * .7;
    col += vec3(.02,.03,.06);
    // dense stars
    col += stars(rd)*1.3 + starLayer(rd, 900., .5, 5.)*.25;
    return col * uVistaI;
}

vec3 homeSky(vec3 rd){
    return stars(rd)*uStarI + homeNebula(rd)*uNebI;
}

// ------------------------------------------------------------ planet
// returns t (km) or -1; colour in col
float isectSphere(vec3 ro, vec3 rd, float r, out float tfar){
    float b = dot(ro, rd);
    float c = dot(ro, ro) - r*r;
    float h = b*b - c;
    tfar = -1.;
    if(h < 0.) return -1.;
    h = sqrt(h);
    tfar = -b + h;
    return -b - h;
}

// ring shadow & geometry helpers in the *centred* ring frame (km)
vec3 ringCentered(vec3 pAnch){ return pAnch + vec3(uRgR, 0., 0.); }

vec3 planetSurface(vec3 n, vec3 L, vec3 wn, vec3 posW){
    // bands with latitude-dependent flow
    float lat = n.y;
    float lon = atan(n.z, n.x);
    float flow = uTime*.004*(1.+2.*sin(lat*9.));
    vec3 q = vec3(cos(lon+flow), lat*1., sin(lon+flow));
    vec3 w = q + .10*vec3(fbm(q*6.,4), fbm(q*6.+3.,4), fbm(q*6.+7.,4));
    float bandCoord = lat*9. + .9*fbm(w*vec3(3.,1.5,3.),5) + .25*fbm(w*14.,4);
    float bands = .5+.5*sin(bandCoord*2.8);
    float fine  = fbm(vec3(w.x*18., lat*80., w.z*18.), 5);
    vec3 cA = vec3(.80,.72,.58);   // cream
    vec3 cB = vec3(.45,.30,.20);   // ochre-brown
    vec3 cC = vec3(.30,.42,.50);   // blue-grey
    vec3 col = mix(cB, cA, bands);
    col = mix(col, cC, smoothstep(.55,.8,fbm(vec3(lat*6., w.xz*2.),4))*.6);
    col *= .8 + .4*fine;
    // a great storm
    vec3 sc = normalize(vec3(.6,-.28,.75));
    float sd = length(n - sc);
    float storm = smoothstep(.16,.02,sd);
    float sw = atan(dot(n-sc, vec3(0,1,0)), dot(n-sc, normalize(cross(sc,vec3(0,1,0)))));
    col = mix(col, vec3(.85,.45,.30)*(0.85+.3*sin(sw*3.+sd*60.)), storm*.8);
    // poles darker
    col *= mix(.6, 1., smoothstep(.95,.6,abs(lat)));

    float ndl = dot(wn, L);
    float diff = max(ndl, 0.);
    // terminator softening
    float term = smoothstep(-.08, .25, ndl);
    vec3 lit = col * uSunCol * (diff*.9 + .12*term) ;
    // forward scattered twilight tint
    lit += vec3(.9,.45,.2) * uSunCol * .05 * smoothstep(-.12,0.,ndl)*smoothstep(.1,-.02,ndl);
    return lit;
}

// ------------------------------------------------------------ gate ring
// Cross-section parameters (km)
const float RW  = 60.;    // radial half-thickness of body
const float RH  = 20.;    // axial half-height
const float WALLH = 9.;   // rim wall height above floor
const float WALLT = 2.5;  // rim wall half-thickness

// signed radial distance to ring centre-line (length(xz_centred) - R), precise near anchor
float ringRad(vec3 p){
    float a = uRgR + p.x;
    return (2.*uRgR*p.x + p.x*p.x + p.z*p.z) / (sqrt(a*a + p.z*p.z) + uRgR);
}
float ringLocalAng(vec3 p){ return atan(p.z, uRgR + p.x); }

float sdBox2(vec2 p, vec2 b){ vec2 d = abs(p)-b; return length(max(d,0.)) + min(max(d.x,d.y),0.); }

// floor greebles: returns height (km, inward) at arc u, axial y
float gFloorH(vec2 uv, float lod){
    // big panels
    vec2 cs = vec2(7., 6.);
    vec2 ci = floor(uv/cs);
    vec2 cf = uv - (ci+.5)*cs;
    float h1 = hash21(ci);
    float edge = sdBox2(cf, cs*.5 - .35);
    float h = (edge < 0.) ? .25 + .55*h1*h1 : 0.;
    // medium blocks
    if(lod > .3){
        vec2 cs2 = vec2(2.2, 1.9);
        vec2 ci2 = floor(uv/cs2);
        vec2 cf2 = uv - (ci2+.5)*cs2;
        float h2 = hash21(ci2+13.);
        float e2 = sdBox2(cf2, cs2*vec2(.30+.15*h2, .28));
        if(h2 > .55 && e2 < 0.) h += .35*(h2-.5);
    }
    // central trench along y≈0 (light groove)
    h *= smoothstep(1.2, 2.2, abs(uv.y));
    return h;
}

// towers: sparse tall blocks (return sdf in (u, y, height) space)
float gTowers(vec3 q){ // q = (u, y, hup)  hup = height above floor
    vec2 cs = vec2(23., 13.);
    vec2 ci = floor(q.xy/cs);
    vec2 cf = q.xy - (ci+.5)*cs;
    float h = hash21(ci+71.);
    if(h < .45 || abs(q.y) < 4.) return 1e5;
    float H = 1.5 + 5.*pow(hash21(ci+3.),2.);
    vec2 sz = vec2(.6+1.2*hash21(ci+9.), .5+.8*hash21(ci+5.));
    vec2 off = (vec2(hash21(ci+1.), hash21(ci+2.))-.5)*(cs-sz*2.-2.);
    vec3 d = abs(vec3(cf-off, q.z - H*.5)) - vec3(sz, H*.5);
    float box = length(max(d,0.)) + min(max(d.x,max(d.y,d.z)),0.);
    // stepped top
    vec3 d2 = abs(vec3(cf-off, q.z - H - .3)) - vec3(sz*.5, .3);
    float top = length(max(d2,0.)) + min(max(d2.x,max(d2.y,d2.z)),0.);
    return min(box, top);
}

// full ring SDF in anchored coords; returns distance, mat id in m
float mapRing(vec3 p, out float m){
    float rad = ringRad(p);
    vec2 q = vec2(rad, p.y);
    float body = sdBox2(q, vec2(RW, RH));
    // rim walls on the inner side
    vec2 wq = vec2(rad + RW + WALLH*.5, abs(p.y) - (RH - WALLT));
    float wall = sdBox2(wq, vec2(WALLH*.5, WALLT));
    float d = min(body, wall);
    m = 0.;
    if(wall < body) m = 1.;
    // outer surface bevel groove rings (cheap look)
    if(uRgDetail > 0. && d < 12.){
        float u = ringLocalAng(p)*uRgR + uRgUOff;
        float hup = -(rad + RW);       // height above floor (km)
        if(abs(p.y) < RH - WALLT*2. && hup > -1.){
            float gh = gFloorH(vec2(u, p.y), uRgDetail);
            float fl = -(hup - gh);    // floor with greebles (positive inside solid)
            float dfl = -fl;           // distance above
            float tw = gTowers(vec3(u, p.y, hup));
            float dd = min(dfl*.7, tw);
            if(dd < d){ m = (tw < dfl*.7) ? 3. : 2.; }
            d = min(d, dd);
        }
    }
    return d;
}

vec3 ringNormal(vec3 p, float t){
    float e = max(.002, t*.0006);
    float m;
    vec2 k = vec2(1,-1);
    return normalize(k.xyy*mapRing(p+k.xyy*e,m) + k.yyx*mapRing(p+k.yyx*e,m) +
                     k.yxy*mapRing(p+k.yxy*e,m) + k.xxx*mapRing(p+k.xxx*e,m));
}

// intersection with bounding torus-ish slab to skip empty space
bool ringBounds(vec3 ro, vec3 rd, out float t0, out float t1){
    // slab |y| < RH + 1
    float Y = RH + 1.;
    float ta, tb;
    if(abs(rd.y) < 1e-6){ if(abs(ro.y) > Y) return false; ta = -1e9; tb = 1e9; }
    else { ta = (-Y - ro.y)/rd.y; tb = (Y - ro.y)/rd.y; if(ta > tb){ float x=ta; ta=tb; tb=x; } }
    // cylinder of radius R + RW + 1 (centred coords)
    vec3 oc = ro + vec3(uRgR,0,0);
    float Ro = uRgR + RW + 1.;
    float a = dot(rd.xz, rd.xz);
    float b = dot(oc.xz, rd.xz);
    float c = dot(oc.xz, oc.xz) - Ro*Ro;
    float h = b*b - a*c;
    if(h < 0.) return false;
    h = sqrt(h);
    float ca = (-b - h)/a, cb = (-b + h)/a;
    t0 = max(max(ta, ca), 0.);
    t1 = min(tb, cb);
    return t1 > t0;
}

float traceRing(vec3 ro, vec3 rd, float tmax, out float mat){
    float t0, t1;
    mat = -1.;
    if(!ringBounds(ro, rd, t0, t1)) return -1.;
    t1 = min(t1, tmax);
    float t = t0;
    for(int i=0;i<260;i++){
        if(t > t1) break;
        vec3 p = ro + rd*t;
        float m;
        float d = mapRing(p, m);
        float eps = max(.0015, t*.00025);
        if(d < eps){ mat = m; return t; }
        t += d*.85;
    }
    return -1.;
}

float ringSoftShadow(vec3 p, vec3 L){
    float res = 1., t = .05;
    for(int i=0;i<48;i++){
        float m;
        float h = mapRing(p + L*t, m);
        res = min(res, 10.*h/t);
        t += clamp(h, .05, 3.);
        if(res < .01 || t > 60.) break;
    }
    return clamp(res, 0., 1.);
}

// cascade: 0..1 lit mask for a true ring angle
float cascadeLit(float ang){
    float d = abs(mod(ang - uBeaconAng + PI, 2.*PI) - PI);
    return smoothstep(uCascade, uCascade - .06, d) * step(.0001, uCascade);
}

// planet shadow on a world point (rel camera, km) along L
float planetShadow(vec3 posW){
    if(uPlOn < .5) return 1.;
    vec3 o = uPlRo + uPlRot*posW/uPlR;
    vec3 l = uPlRot*uSunDir;
    float b = dot(o, l);
    float c = dot(o,o) - 1.;
    float h = b*b - c;
    if(h < 0. || -b < 0.) return 1.;
    // soft penumbra from closest approach
    float ca = sqrt(max(dot(o,o) - b*b, 0.));
    return smoothstep(.985, 1.01, ca);
}

vec3 shadeRing(vec3 p, vec3 rd, float t, float mat, vec3 posW){
    vec3 n = ringNormal(p, t);
    vec3 L = uRgRot*uSunDir;
    float rad = ringRad(p);
    float lang = ringLocalAng(p);
    float trueAng = uRgAnchor + lang;
    float u = lang*uRgR + uRgUOff;
    float hup = -(rad + RW);

    // base albedo: dark machined metal with panel variation
    // second surface coordinate: axial on the floor/outer faces, radial on the flat side faces
    float fv = abs(n.y) > .7 ? rad : p.y;
    vec2 pc = floor(vec2(u, fv)/vec2(3.5, 3.));
    float pv = hash21(pc);
    float fwp = t*gPix;
    pv = mix(pv, .5, smoothstep(.4, 2.5, fwp));           // filter small panels at distance
    // large-scale structure readable from far away: 40 km segments + 120 km ribs
    float seg = hash21(vec2(floor(u/40.), 3.));
    float rib = smoothstep(2.5 + fwp, 0., abs(fract(u/120.)-.5)*120.);
    vec3 alb = vec3(.24,.25,.27) * (.75 + .5*pv) * (.8 + .4*seg) * (1. - .45*rib);
    if(mat == 1.) alb = vec3(.17,.17,.19);
    if(mat == 3.) alb = vec3(.23,.22,.22)*(.8+.4*hash21(floor(vec2(u,fv)/.8)));
    // panel seams (screen-space aware to avoid aliasing)
    float fw = max(t*gPix*1.5, .02);
    vec2 sv = abs(fract(vec2(u,fv)/vec2(3.5,3.)) - .5)*vec2(3.5,3.);
    float seam = 1. - smoothstep(1.75-fw, 1.75, max(sv.x/1.,0.)) ;
    alb *= mix(.55, 1., smoothstep(1.75, 1.75 - .08 - fw, sv.x) * smoothstep(1.5, 1.5 - .08 - fw, sv.y));

    float sh = planetShadow(posW);
    if(uRgShadow > .5 && sh > 0.) sh *= ringSoftShadow(p + n*.02, L);
    float ndl = max(dot(n, L), 0.);
    vec3 h = normalize(L - rd);
    float spec = pow(max(dot(n,h),0.), 60.) * .6;
    float fres = pow(1. - max(dot(n,-rd),0.), 5.);
    vec3 col = alb * uSunCol * ndl * sh + uSunCol*spec*sh*(.04+.3*fres);
    // planet-shine ambient (warm, from the gas giant) + sky
    col += alb * (vec3(.030,.026,.022) * (.5+.5*n.x) + vec3(.006,.008,.012));

    // probe point light
    if(uPbOn > .5){
        vec3 lv = uPbLightRg - p;
        float ld = length(lv);
        vec3 ll = lv/ld;
        float att = 1./(1. + ld*ld*8.);
        col += alb * vec3(1.,.55,.22) * uPbCore * max(dot(n,ll),0.) * att * 2.2;
    }

    // ---------------- emissive lights
    vec3 em = vec3(0);
    float lit = cascadeLit(trueAng);
    float pw = uRgPower;
    // floor centre groove
    float gw = max(.35, fw*.8);
    float groove = smoothstep(gw, 0., abs(p.y)) * step(hup, .3);
    float pulse = .6+.4*sin(u*.35 - uTime*6.);
    em += groove * vec3(.35,.7,1.) * (lit*(2.5+2.*pulse) + pw*6.);
    // rim wall top lights: dotted every 1.5 km
    if(mat == 1. || (mat != 0. && abs(p.y) > RH - WALLT*2.5)){
        float wy = abs(p.y) - (RH - WALLT);
        float top = smoothstep(.8, .0, abs(hup - WALLH + .5));
        float dots = smoothstep(.35 + fw, .0, abs(fract(u/1.5)-.5)*1.5);
        dots = mix(dots, .35, clamp(fw*.3, 0., 1.));
        em += top*dots * vec3(.55,.8,1.) * (lit*5. + pw*9.) * step(abs(wy), WALLT+.1);
    }
    // tower windows
    if(mat == 3.){
        float wz = fract(hup*3.);
        float wx = fract(u*2.5 + p.y*2.5);
        float win = step(.6, hash21(floor(vec2(u*2.5+p.y*2.5, hup*3.)))) * step(.4,wz) * step(.3,wx);
        em += win * vec3(.4,.75,1.) * lit * 1.5 * (.4 + .6*smoothstep(0., 2., fw) );
    }
    // outer surface: faint seam lights when powered
    if(mat == 0. && rad > RW - .5) em += vec3(.4,.7,1.)*pw*.8*smoothstep(.2,0.,abs(fract(u/30.)-.5)*30.);
    // inner edge glow when powered (energy on the whole inner face)
    em += vec3(.3,.6,1.) * pw*pw * .5 * step(hup, 1.) * (.5+.5*fbm(vec3(u*.05, p.y*.1, uTime*.8),3));

    // beacon: a light at floor near the beacon angle (drawn in glow pass); tint local floor
    return col + em;
}

// ------------------------------------------------------------ probe
float sdCapsule(vec3 p, vec3 a, vec3 b, float r){ vec3 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h)-r; }
float sdTorus(vec3 p, vec2 t){ vec2 q = vec2(length(p.xz)-t.x, p.y); return length(q)-t.y; }

float mapProbe(vec3 p, out float m){
    // shell cage
    float r = length(p);
    float shell = abs(r - .92) - .06;
    // slots: latitude bands, cut through
    float lat = asin(clamp(p.y/max(r,1e-4),-1.,1.));
    float slots = abs(fract(lat*3.2/PI*2.) - .5) - .18;   // negative in slot
    float lonCut = abs(fract(atan(p.z,p.x)/(2.*PI)*6.) - .5) - .38;
    float cut = max(slots, lonCut) ;
    shell = max(shell, cut*1.2);
    float d = shell; m = 0.;
    // core
    float core = r - .52;
    if(core < d){ d = core; m = 1.; }
    // equatorial ring
    float ring = sdTorus(p, vec2(1.22, .055));
    ring = min(ring, sdCapsule(p, vec3(.9,0,0), vec3(1.2,0,0), .04));
    ring = min(ring, sdCapsule(p, vec3(-.9,0,0), vec3(-1.2,0,0), .04));
    if(ring < d){ d = ring; m = 2.; }
    // eye (front = +z)
    float eye = length(p - vec3(0,.1,.93)) - .24;
    float eyeRim = sdTorus((p - vec3(0,.1,.97)).xzy, vec2(.25,.045));
    if(min(eye,eyeRim) < d){ d = min(eye,eyeRim); m = (eye < eyeRim) ? 3. : 2.; }
    // antennas
    float ant = sdCapsule(p, vec3(.25,.85,-.2), vec3(.75,2.3,-.7), .018);
    ant = min(ant, sdCapsule(p, vec3(-.25,.85,-.2), vec3(-.55,1.9,-.9), .018));
    ant = min(ant, length(p - vec3(.75,2.3,-.7)) - .05);
    // small side fins (solar)
    vec3 fq = vec3(abs(p.x) - 1.75, p.y, p.z);
    vec3 fd = abs(fq) - vec3(.45, .015, .32);
    float fin = length(max(fd,0.)) + min(max(fd.x,max(fd.y,fd.z)),0.);
    if(ant < d){ d = ant; m = 2.; }
    if(fin < d){ d = fin; m = 4.; }
    return d;
}

vec3 probeNormal(vec3 p){
    float m; vec2 k = vec2(1,-1); float e = .002;
    return normalize(k.xyy*mapProbe(p+k.xyy*e,m) + k.yyx*mapProbe(p+k.yyx*e,m) +
                     k.yxy*mapProbe(p+k.yxy*e,m) + k.xxx*mapProbe(p+k.xxx*e,m));
}

float traceProbe(vec3 ro, vec3 rd, out float mat){
    mat = -1.;
    float tf;
    float t0 = isectSphere(ro, rd, 2.6, tf);
    if(tf < 0.) return -1.;
    float t = max(t0, 0.);
    for(int i=0;i<120;i++){
        vec3 p = ro + rd*t;
        float m;
        float d = mapProbe(p, m);
        if(d < .0015*max(1.,t*.3)){ mat = m; return t; }
        t += d*.9;
        if(t > tf) break;
    }
    return -1.;
}

vec3 coreCol(){ return vec3(1.,.58,.22); }

vec3 shadeProbe(vec3 p, vec3 rd, float mat, vec3 envL, vec3 envCol){
    vec3 n = probeNormal(p);
    vec3 L = uPbRot*uSunDir;
    if(mat == 1.){
        // glowing core with a hot centre
        float f = pow(max(dot(n,-rd),0.), 2.);
        return coreCol() * uPbCore * (3. + 7.*f);
    }
    vec3 alb = vec3(.55,.53,.5);
    float rough = 30.;
    if(mat == 2.) { alb = vec3(.35,.33,.30); rough = 60.; }
    if(mat == 3.) { alb = vec3(.02,.03,.04); rough = 300.; }
    if(mat == 4.) {
        vec2 g = abs(fract(p.xz*vec2(6.,5.)) - .5);
        alb = mix(vec3(.05,.07,.14), vec3(.25,.25,.28), step(.44, max(g.x,g.y)));
        rough = 120.;
    }
    // subtle wear
    alb *= .85 + .3*vnoise(p*14.);
    float ndl = max(dot(n,L),0.);
    vec3 h = normalize(L - rd);
    float spec = pow(max(dot(n,h),0.), rough) * (mat==3. ? 3. : .5);
    float fres = pow(1. - max(dot(n,-rd),0.), 4.);
    vec3 col = (alb * ndl + spec) * uSunCol * uPbSun;
    // secondary environment light (planet bounce / portal / vista)
    col += alb * envCol * max(dot(n, envL)*.5+.5, 0.) ;
    col += envCol * fres * .25;
    // core light spilling onto the inside of the cage
    float r = length(p);
    col += alb * coreCol() * uPbCore * 1.2 * smoothstep(1.02,.55,r) * max(dot(n, -normalize(p)), 0.);
    // cage outer rim catches core light through the slots
    col += coreCol() * uPbCore * .04 * smoothstep(1.,.9,r);
    // eye glint
    if(mat == 3.) col += vec3(.4,.8,1.) * .6 * smoothstep(.12,.0, length(p.xy - vec2(.05,.18))) * (.6+.4*uPbCore);
    return col;
}

// ------------------------------------------------------------ glows
// emission from a thin spherical shell (centre c rel ray origin, radius r, thickness w) along a ray up to depth tmax
float shellGlow(vec3 rd, vec3 c, float r, float w, float tmax){
    float tc = dot(c, rd);
    vec3 cp = c - rd*tc;
    float d2 = dot(cp,cp);
    float ro2 = r*r, ri = max(r - w, 0.), ri2 = ri*ri;
    if(d2 > ro2) return 0.;
    float so = sqrt(ro2 - d2);
    float si = d2 < ri2 ? sqrt(ri2 - d2) : 0.;
    // two chords: [tc-so, tc-si] and [tc+si, tc+so]; clip by tmax and >0
    float a1 = clamp(tc - so, 0., tmax), b1 = clamp(tc - si, 0., tmax);
    float a2 = clamp(tc + si, 0., tmax), b2 = clamp(tc + so, 0., tmax);
    return ((b1 - a1) + (b2 - a2)) / max(w, 1e-6);
}

// glow of a point light (pos rel camera) with depth test; size in km
vec3 pointGlow(vec3 rd, vec3 c, float size, float tmax, vec3 col){
    float tc = dot(c, rd);
    if(tc < 0.) return vec3(0);
    if(tc > tmax*1.001 && tmax > 0.) return vec3(0);
    float d = length(c - rd*tc);
    float x = d/size;
    float pix = gPix*tc/size;           // pixel footprint in glow units
    float core = 1./(1. + x*x*40.) ;
    float halo = exp(-x*1.5)*.08;
    // keep far lights from vanishing under a pixel
    float boost = 1. + pix*pix*.0;
    return col * (core + halo) * boost;
}

// ------------------------------------------------------------ main
void main(){
    vec2 frag = gl_FragCoord.xy + uJitter;
    vec2 uv = (frag - .5*uRes) / (.5*uRes.y);
    gPix = uTanHalf*2./uRes.y;
    vec3 rd = normalize(uCam * vec3(uv*uTanHalf, 1.));

    vec3 col = vec3(0);
    float tHit = 1e12;

    if(uMode == 1){
        // ------------------------------ tunnel
        vec3 f = uCam[2];
        // tunnel axis = camera forward-ish; use world ray in camera frame
        vec3 lr = transpose(uCam)*rd;
        float rr = length(lr.xy);
        float ang = atan(lr.y, lr.x);
        float tz = 1./max(rr, 1e-3);
        float z = tz*lr.z + uTunT*140.;
        float n = fbm(vec3(ang*3./PI*4., z*.06, 0.), 4);
        float streak = pow(fbm(vec3(ang*24./PI, z*.012, 2.), 4), 3.)*4.;
        vec3 cA = vec3(.25,.55,1.), cB = vec3(1.,.7,.35);
        vec3 tc = mix(cA, cB, smoothstep(.3,.9,uTunT + .2*sin(z*.01)));
        float fog = exp(-tz*.02);
        col = tc * (streak*1.8 + n*.25) * fog;
        col += mix(cA, vec3(1.,.95,.85), uTunT) * exp(-rr*rr*30.) * (1.+uTunT*6.);    // light at the end
        col += vistaSky(rd)*.0;
        tHit = 1e12;
    } else {
        // ------------------------------ background
        vec3 rdB = rd;
        // space ripple around ring centre (lensing) — bends background & planet
        if(uRgOn > .5 && uRipple > 0.){
            vec3 cC = -(uRgRot*vec3(0.)) ; // placeholder (unused)
        }
        vec3 bg = (uMode == 2) ? vistaSky(rd) : homeSky(rd);
        col = bg;

        // ------------------------------ ring-centre lensing uses the ring frame
        vec3 rgRd = uRgRot*rd;
        vec3 ringCentreRel = vec3(0);
        if(uRgOn > .5){
            // centre of ring in anchored frame is (-R,0,0); vector from camera:
            vec3 cRel = vec3(-uRgR,0,0) - uRgRo;
            float tc = dot(cRel, rgRd);
            float dd = length(cRel - rgRd*tc);
            float Rin = uRgR - RW;
            if(uRipple > 0. && tc > 0.){
                float x = dd/Rin;
                float wv = sin(x*28. - uTime*5.)*exp(-x*2.2)*smoothstep(1.,.6,x);
                vec3 dir = normalize(cRel - rgRd*tc);
                vec3 rb = normalize(rgRd + dir*wv*uRipple*.012);
                rdB = transpose(uRgRot)*rb;
                col = (uMode == 2) ? vistaSky(rdB) : homeSky(rdB);
            }
        }
        col += sunLight(rdB);

        // ------------------------------ planet
        if(uPlOn > .5){
            vec3 pro = uPlRo, prd = uPlRot*rdB;
            float tf;
            float t = isectSphere(pro, prd, 1., tf);
            // atmosphere halo (outside)
            float b = dot(pro, prd);
            vec3 cp = pro - prd*b;
            float ca = length(cp);
            vec3 Lp = uPlRot*uSunDir;
            if(b < 0.){
                float alt = ca - 1.;
                vec3 limbN = normalize(cp);
                float sunSide = smoothstep(0., .7, dot(limbN, Lp));
                float cs = max(dot(prd, Lp), 0.);
                float fwd = pow(cs, 6.);
                float fwdS = pow(cs, 900.);
                float halo = exp(-max(alt,0.)/.010) * (sunSide*.5 + fwd*.35 + fwdS*14.) + exp(-max(alt,0.)/.05)*(fwd*.08 + fwdS*2.5);
                vec3 hcol = mix(vec3(.35,.55,1.), vec3(1.,.6,.35), fwd);
                col += hcol * uSunCol * halo * step(0., alt) * .9;
            }
            if(t > 0.){
                vec3 ph = pro + prd*t;
                vec3 n = normalize(ph);
                vec3 posW = rd*t*uPlR;
                // ring shadow on planet
                float rs = 1.;
                if(uRgOn > .5){
                    vec3 pr = uRgRot*posW + uRgRo;       // anchored ring frame
                    vec3 L = uRgRot*uSunDir;
                    if(abs(L.y) > 1e-4){
                        float ts = -pr.y / L.y;
                        if(ts > 0.){
                            vec3 q = pr + L*ts;
                            float rr = length(q.xz + vec2(uRgR, 0.)) - uRgR;
                            rs = smoothstep(RW*.6, RW*1.8, abs(rr));
                        }
                    }
                }
                vec3 pc = planetSurface(n, Lp, n, posW) * mix(.15, 1., rs);
                // rim atmosphere
                float rim = pow(1. - max(dot(n, -prd), 0.), 3.);
                float sunF = smoothstep(-.3, .5, dot(n, Lp));
                pc += vec3(.35,.55,1.) * uSunCol * rim * sunF * sunF * .5;
                float rimT = pow(1. - max(dot(n, -prd), 0.), 8.);
                pc += vec3(1.,.55,.3) * uSunCol * rimT * (pow(max(dot(prd,Lp),0.),900.)*3. + pow(max(dot(prd,Lp),0.),8.)*.05);
                // faint planetshine on the night side so the disc is not a hole
                pc += vec3(.010,.011,.014) * (.5 + .5*fbm(n*vec3(3.,20.,3.),3));
                // night-side lightning
                if(uPlLight > 0.){
                    vec3 lp = n*14.;
                    vec3 lc = floor(lp);
                    float tick = floor(uTime*2.3);
                    float hl = hash31(lc + tick*7.13);
                    vec3 cpos = lc + .2 + .6*hash33(lc + tick);
                    float blob = exp(-dot(lp-cpos, lp-cpos)*30.);
                    float life = exp(-fract(uTime*2.3)*5.);
                    float fl = step(.965, hl) * blob * life * smoothstep(.2, -.05, dot(n,Lp));
                    pc += vec3(.55,.65,1.) * fl * uPlLight * .12;
                }
                col = pc;
                tHit = t*uPlR;
            }
        }

        // ------------------------------ ring
        float ringT = -1.;
        if(uRgOn > .5){
            float mat;
            float tr = traceRing(uRgRo, rgRd, tHit, mat);
            if(tr > 0. && tr < tHit){
                vec3 p = uRgRo + rgRd*tr;
                col = shadeRing(p, rgRd, tr, mat, rd*tr);
                tHit = tr;
                ringT = tr;
            }
            // portal disc in ring plane (behind nothing but ring itself)
            vec3 cRel = vec3(-uRgR,0,0) - uRgRo;
            float Rin = uRgR - RW;
            if(abs(rgRd.y) > 1e-5){
                float tp = -uRgRo.y / rgRd.y;
                if(tp > 0. && tp < tHit){
                    vec3 pp = uRgRo + rgRd*tp;
                    vec2 pl = pp.xz + vec2(uRgR, 0.);
                    float rr = length(pl);
                    float x = rr / Rin;
                    float a = atan(pl.y, pl.x);
                    // filaments & core glow (in-plane energy)
                    if(uFilaments > 0.){
                        float fil = 0.;
                        float nf = 18.;
                        float sa = a*nf/(2.*PI);
                        float fk = abs(fract(sa + .15*sin(x*9. - uTime*3.) + .05*sin(uTime*1.7+floor(sa))) - .5);
                        float fwid = max(.03, gPix*tp*nf/(2.*PI*max(rr,1.))*1.5);
                        fil = smoothstep(fwid, 0., fk) * smoothstep(1.02,.9,x) * smoothstep(0.,.3,x);
                        float travel = fract(x*3. + uTime*1.8);
                        fil *= .5 + .5*smoothstep(.0,.2,travel)*smoothstep(.6,.2,travel);
                        col += vec3(.35,.65,1.) * fil * uFilaments * 1.2;
                    }
                    if(uPortal > 0.){
                        float pr = uPortal;
                        if(x < pr){
                            // swirl the view into the other side
                            float sw = (1. - x/pr);
                            vec3 vd = rd;
                            // rotate around ring axis (world) by swirl
                            vec3 ax = transpose(uRgRot)*vec3(0,1,0);
                            float sa = sw*sw*2.5 + uTime*.05;
                            vd = vd*cos(sa) + cross(ax, vd)*sin(sa) + ax*dot(ax,vd)*(1.-cos(sa));
                            vec3 inside = vistaSky(normalize(vd)) * 1.3;
                            // spiral streaks (seam-free: angle enters via cos/sin, twisted by log radius)
                            float sp = a + log(x/pr + .02)*1.6 - uTime*.6;
                            float vort = fbm(vec3(cos(sp)*2., sin(sp)*2., log(x/pr + .02)*2. - uTime*.5), 4);
                            float streak = smoothstep(.5, .85, vort);
                            inside += mix(vec3(.35,.6,1.), vec3(1.,.85,.6), x/pr) * streak * 1.4 * smoothstep(.25, 1., x/pr);
                            col = inside;
                            tHit = tp;
                        }
                        // blazing rim
                        float rimd = abs(x - pr) * Rin;
                        float rimW = max(Rin*.012, gPix*tp*2.);
                        float flick = .7 + .6*fbm(vec3(cos(a)*8., sin(a)*8., uTime*2.), 3);
                        col += mix(vec3(.5,.75,1.), vec3(1.,.9,.7), .5) * (exp(-rimd/rimW)*6. + exp(-rimd/(rimW*8.))*.8) * flick * smoothstep(0., .02, pr);
                    }
                }
            }
            // centre point glow
            if(uCoreGlow > 0.){
                vec3 cW = transpose(uRgRot)*cRel;
                col += pointGlow(rd, cW, Rin*.03, tHit, vec3(.6,.8,1.)) * uCoreGlow * 3.;
                float tc = dot(cW, rd);
                float dd = length(cW - rd*tc)/Rin;
                col += vec3(.4,.6,1.) * exp(-dd*6.) * uCoreGlow * .25 * step(0., tc);
            }
            // beacon light
            if(uBeacon > 0.){
                float la = uBeaconAng - uRgAnchor;
                vec3 bA = vec3(cos(la)*(uRgR - RW - .9) - uRgR, 0., sin(la)*(uRgR - RW - .9));
                vec3 bW = transpose(uRgRot)*(bA - uRgRo);
                col += pointGlow(rd, bW, .5, tHit, vec3(.55,.8,1.)) * uBeacon * 6.;
            }
            // shockwave (ring-centre sphere)
            if(uShockI > 0. && uShockR > 0.){
                vec3 cW = transpose(uRgRot)*cRel;
                float sg = shellGlow(rd, cW, uShockR, uShockR*.06, tHit);
                col += vec3(.7,.85,1.) * sg * uShockI * .6;
            }
        }
    }

    // ------------------------------ probe (all modes)
    if(uPbOn > .5){
        vec3 prd = uPbRot*rd;
        float mat;
        float tp = traceProbe(uPbRo, prd, mat);
        if(tp > 0. && tp*uPbScale < tHit){
            vec3 p = uPbRo + prd*tp;
            vec3 envL = normalize(uPbRot*vec3(0.,-.3,1.));
            vec3 envC = vec3(.03,.03,.035);
            if(uMode == 1) envC = vec3(.5,.55,.7)*(.4+uTunT);
            if(uMode == 2) envC = vec3(.18,.16,.22);
            if(uPortal > 0. && uMode == 0) { envC = vec3(.35,.5,.8)*uPortal*1.5; envL = normalize(uPbRot*(uPbPosW*-1.)); }
            col = shadeProbe(p, prd, mat, envL, envC);
            tHit = tp*uPbScale;
        }
        // core glow (visible through everything in front of it)
        vec3 gc = coreCol();
        float gs = uPbScale * .9 * uPbGlowSize;
        float occ = (tHit < tp*uPbScale*1.0001 && tp > 0.) ? -1. : tHit;
        col += pointGlow(rd, uPbPosW, gs, occ, gc) * uPbCore * mix(.7, 3., smoothstep(1., 4., uPbGlowSize));
        // wide soft lantern halo
        {
            float tc = dot(uPbPosW, rd);
            if(tc > 0. && (occ < 0. || tc < occ*1.001)){
                float x = length(uPbPosW - rd*tc)/(gs*6.);
                col += gc * uPbCore * .06 / (1. + x*x) * smoothstep(1., 4., uPbGlowSize);
            }
        }
    }

    // ------------------------------ pings
    for(int i=0;i<6;i++){
        vec4 pg = uPing[i];
        vec4 pp = uPingP[i];
        if(pp.x <= 0.) continue;
        vec3 pcol = pp.z < .5 ? vec3(1.,.62,.28) : (pp.z < 1.5 ? vec3(.45,.75,1.) : vec3(1.));
        float g = shellGlow(rd, pg.xyz, pg.w, pp.y, tHit);
        // once the shell has swept past the camera it would wash the frame: fade it
        float inside = smoothstep(pg.w*1.02, pg.w*.8, length(pg.xyz));
        g = max(g - 2.2, 0.) + .15*min(g, 2.2);   // mostly limb: a ring of light, faint face
        col += pcol * g * pp.x * .12 * (1. - .9*inside);
    }

    // ------------------------------ swarm of lanterns (other side)
    if(uMode == 2 && uSwarm > 0.){
        for(int i=0;i<140;i++){
            float fi = float(i);
            vec3 h = hash33(vec3(fi, 7.1, 3.3));
            vec3 dir = normalize(h*2. - 1. + vec3(0., 0., .0));
            float dist = .03 + 2.2*pow(hash11(fi*1.7+.3), 1.6);
            vec3 c = uSwC + dir*dist;
            float act = 2.1 + 6.0*pow(hash11(fi*3.1+.7), .8) + dist*.9;   // seconds after swarm start
            if(i == 0){ act = 2.1; c = uSwC + normalize(vec3(.8,.15,.9))*.09; }
            float a = uSwarm - act;
            if(a < 0.) continue;
            float on = smoothstep(0., .25, a);
            float fl = .85 + .15*sin(uTime*3. + fi);
            // keep every lantern at least a few pixels wide: they are the payoff
            float lsz = max(.0012*(1.+dist*.3), gPix*max(dot(c,rd),0.)*3.5);
            col += pointGlow(rd, c, lsz, tHit, vec3(1.,.6,.26)) * on * fl * 2.4;
            // answer ping shell
            if(a < 3.){
                float r = a*.06*(1. + dist);
                col += vec3(1.,.66,.32) * shellGlow(rd, c, r, r*.08 + .0005, tHit) * (1. - a/3.) * .03;
            }
        }
    }
    if(uMode == 2 && uSwFar > 0.){
        // far lanterns as a sky layer: warm points spreading across the vista
        for(int L=0; L<2; L++){
            float sc = L==0 ? 70. : 150.;
            vec3 p = rd*sc;
            vec3 cc = floor(p);
            vec3 h = hash33(cc + 11.*float(L));
            if(h.x < (L==0 ? .10 : .05)){
                vec3 sp = normalize(cc + .25 + .5*hash33(cc+4.+float(L)));
                float d = length(rd - sp);
                float w = max(gPix*1.1, .0006);
                float act = h.y * 8.;
                float on = smoothstep(act, act + .6, uSwFar*8.);
                float br = (.6 + 1.6*h.z) * (L==0 ? 1. : .6) * (.0006*.0006)/(w*w);
                col += vec3(1.,.62,.3) * exp(-d*d/(w*w)) * on * br * (.8+.2*sin(uTime*2.+h.z*40.));
            }
        }
    }

    col += vec3(uFlash);
    fragColor = vec4(col * uExposure, 1.);
}
