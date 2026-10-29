#version 330
in vec2 in_pos;
out vec2 vUv;
void main(){ vUv = in_pos*.5+.5; gl_Position = vec4(in_pos, 0., 1.); }
