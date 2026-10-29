#version 330
// tent upsample of the coarser level, added to this level
in vec2 vUv; out vec4 o;
uniform sampler2D uCoarse; uniform sampler2D uFine; uniform vec2 uTexel; uniform float uRadius;
void main(){
    vec2 t = uTexel*uRadius;
    vec3 c = texture(uCoarse, vUv + vec2(-t.x, t.y)).rgb + 2.*texture(uCoarse, vUv + vec2(0, t.y)).rgb + texture(uCoarse, vUv + t).rgb
           + 2.*texture(uCoarse, vUv + vec2(-t.x,0)).rgb + 4.*texture(uCoarse, vUv).rgb + 2.*texture(uCoarse, vUv + vec2(t.x,0)).rgb
           + texture(uCoarse, vUv - t).rgb + 2.*texture(uCoarse, vUv + vec2(0,-t.y)).rgb + texture(uCoarse, vUv + vec2(t.x,-t.y)).rgb;
    o = vec4(texture(uFine, vUv).rgb + c/16., 1.);
}
