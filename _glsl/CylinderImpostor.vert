
attribute vec3 mapping;
attribute vec3 position1;
attribute vec3 position2;
attribute float radius;
varying vec3 axis;varying vec4 base_radius;varying vec4 end_b;varying vec3 U;varying vec3 V;
varying vec4 w;
#ifdef PICKING
#include unpack_color
attribute float primitiveId;
varying vec3 vPickingColor;
#else
attribute vec3 color2;
varying vec3 vColor1;
varying vec3 vColor2;
#endif
uniform mat4 modelViewMatrixInverse;
uniform float ortho;
#include matrix_scale
void main(){
#ifdef PICKING
vPickingColor = unpackColor( primitiveId );
#else
vColor1 = color;
vColor2 = color2;
#endif
base_radius.w = radius * matrixScale( modelViewMatrix );
vec3 center = position;
vec3 dir = normalize( position2 - position1 );
float ext = length( position2 - position1 ) / 2.0;
vec3 cam_dir;
if( ortho == 0.0 ){
cam_dir = ( modelViewMatrixInverse * vec4( 0, 0, 0, 1 ) ).xyz - center;
}else{
cam_dir = ( modelViewMatrixInverse * vec4( 0, 0, 1, 0 ) ).xyz;
}
cam_dir = normalize( cam_dir );
vec3 ldir;
float b = dot( cam_dir, dir );
end_b.w = b;
if( b < 0.0 )
ldir = -ext * dir;
else
ldir = ext * dir;
vec3 left = radius * normalize( cross( cam_dir, ldir ) );
vec3 up = radius * normalize( cross( left, ldir ) );
axis = normalize( normalMatrix * ldir );
U = normalize( normalMatrix * up );
V = normalize( normalMatrix * left );
vec4 base4 = modelViewMatrix * vec4( center - ldir, 1.0 );
base_radius.xyz = base4.xyz / base4.w;
vec4 end4 = modelViewMatrix * vec4( center + ldir, 1.0 );
end_b.xyz = end4.xyz / end4.w;
w = modelViewMatrix * vec4(
center + mapping.x*ldir + mapping.y*left + mapping.z*up, 1.0
);
gl_Position = projectionMatrix * w;
gl_Position.z = 0.99;
}