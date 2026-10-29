#version 330
// 13-tap downsample (Jimenez 2014); first pass applies a soft knee to tame fireflies
in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform vec2 uTexel; uniform int uFirst;
vec3 s(vec2 off){ return texture(uTex, vUv + off*uTexel).rgb; }
vec3 kar(vec3 c){ return c / (1. + max(max(c.r,c.g),c.b)*.25); }
void main(){
    vec3 a=s(vec2(-2,2)),b=s(vec2(0,2)),c=s(vec2(2,2)),d=s(vec2(-2,0)),e=s(vec2(0,0)),f=s(vec2(2,0)),
         g=s(vec2(-2,-2)),h=s(vec2(0,-2)),i=s(vec2(2,-2)),j=s(vec2(-1,1)),k=s(vec2(1,1)),l=s(vec2(-1,-1)),m=s(vec2(1,-1));
    vec3 r;
    if(uFirst == 1){
        r = (kar((j+k+l+m)*.25)*.5 + kar((a+b+d+e)*.25)*.125 + kar((b+c+e+f)*.25)*.125 + kar((d+e+g+h)*.25)*.125 + kar((e+f+h+i)*.25)*.125);
    } else {
        r = e*.125 + (a+c+g+i)*.03125 + (b+d+f+h)*.0625 + (j+k+l+m)*.125;
    }
    o = vec4(r, 1.);
}
