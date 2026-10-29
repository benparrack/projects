#version 330
// final: bloom mix, tonemap, grade, vignette, grain, letterbox, text, fades. Output flipped for top-down readback.
in vec2 vUv; out vec4 o;
uniform sampler2D uHdr; uniform sampler2D uBloom; uniform sampler2D uText;
uniform vec2 uOutRes; uniform float uSceneAspect; uniform float uBloomAmt;
uniform float uFade; uniform float uTextA; uniform float uFrame; uniform float uGrain;
uniform float uCA; uniform float uLetterbox;
float hash(vec3 p){ p = fract(p*.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
void main(){
    vec2 uv = vec2(vUv.x, 1. - vUv.y);            // flip: row 0 = top for readback
    float outAspect = uOutRes.x/uOutRes.y;
    float h = mix(1., outAspect/uSceneAspect, uLetterbox);   // fraction of height used by picture
    float y0 = .5 - h*.5;
    vec2 suv = vec2(uv.x, (uv.y - y0)/h);
    vec3 col = vec3(0);
    if(suv.y >= 0. && suv.y <= 1.){
        vec2 sv = suv;                               // uv already flipped, so this is GL texture space
        vec2 cc = sv - .5;
        float ca = uCA * dot(cc,cc);
        vec3 hdr;
        hdr.r = texture(uHdr, sv - cc*ca).r;
        hdr.g = texture(uHdr, sv).g;
        hdr.b = texture(uHdr, sv + cc*ca).b;
        vec3 bl = texture(uBloom, sv).rgb / 7.;
        vec3 c = mix(hdr, bl, uBloomAmt);
        // grade: slight teal shadows / warm highlights
        float lum = dot(c, vec3(.2126,.7152,.0722));
        c = mix(c, c*vec3(.92,1.,1.08), smoothstep(.3,0.,lum)*.5);
        c = aces(c*1.0);
        // vignette
        vec2 vq = (sv - .5)*vec2(uSceneAspect, 1.);
        c *= 1. - .35*smoothstep(.35, 1.25, length(vq));
        col = pow(c, vec3(1./2.2));
        // grain
        float g = hash(vec3(gl_FragCoord.xy, uFrame)) - .5;
        col += g * uGrain * (1.2 - col);
    }
    col *= uFade;
    vec4 tx = texture(uText, vec2(vUv.x, vUv.y));
    col = mix(col, tx.rgb, tx.a * uTextA);
    // dither to 8-bit
    col += (hash(vec3(gl_FragCoord.xy, uFrame+17.)) - .5)/255.;
    o = vec4(clamp(col,0.,1.), 1.);
}
