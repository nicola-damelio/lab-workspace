#define STANDARD
#define IMPOSTOR
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 interiorColor;
uniform float interiorDarkening;
uniform float roughness;
uniform float metalness;
uniform float opacity;
uniform float clipNear;
uniform mat4 projectionMatrix;
uniform float ortho;
varying vec3 axis;
varying vec4 base_radius;
varying vec4 end_b;
varying vec3 U;
varying vec3 V;
varying vec4 w;
#ifdef PICKING
uniform float objectId;
varying vec3 vPickingColor;
#else
varying vec3 vColor1;
varying vec3 vColor2;
#include common
#include fog_pars_fragment
#include bsdfs
#include lights_pars_begin
#include lights_physical_pars_fragment
#endif
bool interior = false;
float distSq3( vec3 v3a, vec3 v3b ){
return (
( v3a.x - v3b.x ) * ( v3a.x - v3b.x ) +
( v3a.y - v3b.y ) * ( v3a.y - v3b.y ) +
( v3a.z - v3b.z ) * ( v3a.z - v3b.z )
);
}
float calcDepth( in vec3 cameraPos ){
vec2 clipZW = cameraPos.z * projectionMatrix[2].zw + projectionMatrix[3].zw;
return 0.5 + 0.5 * clipZW.x / clipZW.y;
}
float calcClip( vec3 cameraPos ){
return dot( vec4( cameraPos, 1.0 ), vec4( 0.0, 0.0, 1.0, clipNear - 0.5 ) );
}
void main(){
vec3 ray_target = w.xyz / w.w;
vec3 base = base_radius.xyz; float vRadius = base_radius.w; vec3 end = end_b.xyz; float b = end_b.w;
vec3 ray_origin = vec3(0.0); vec3 ortho_ray_direction = vec3(0.0, 0.0, 1.0); vec3 persp_ray_direction = normalize(ray_origin - ray_target);
vec3 ray_direction = mix(persp_ray_direction, ortho_ray_direction, ortho);
mat3 basis = mat3( U, V, axis );
vec3 diff = ray_target - 0.5 * (base + end);
vec3 P = diff * basis;
float dz = dot( axis, ray_direction );
float radius2 = vRadius*vRadius;
vec3 D = vec3(dot(U, ray_direction),
dot(V, ray_direction),
dz);
float a0 = P.x*P.x + P.y*P.y - radius2;
float a1 = P.x*D.x + P.y*D.y;
float a2 = D.x*D.x + D.y*D.y;
float d = a1*a1 - a0*a2;
if (d < 0.0) {
discard;
}
float dist = (-a1 + sqrt(d)) / a2;
vec3 surface_point = ray_target + dist * ray_direction;
vec3 base_to_surface = surface_point - base;
vec3 _normal = normalize( base_to_surface - axis * dot(base_to_surface, axis) );
float base_cap_test = dot( base_to_surface, axis );
float end_cap_test = dot((surface_point - end), axis);
#ifndef CAP
vec3 new_point2 = ray_target + ( (-a1 - sqrt(d)) / a2 ) * ray_direction;
vec3 tmp_point2 = new_point2 - base;
#endif
if (base_cap_test < 0.0) {
float dNV;
float near;
vec3 front_point;
if ( ortho == 1.0 ) {
front_point = ray_target;
} else {
dNV = dot(-axis, ray_direction);
near = dot(-axis, (base)) / dNV;
front_point = ray_direction * near + ray_origin;
}
if (dot(front_point - base, front_point-base) > radius2) {
discard;
}
#ifdef CAP
surface_point = front_point;
_normal = axis;
#else
surface_point = ray_target + ( (-a1 - sqrt(d)) / a2 ) * ray_direction;
dNV = dot(-axis, ray_direction);
near = dot(axis, end) / dNV;
new_point2 = ray_direction * near + ray_origin;
if (dot(new_point2 - end, new_point2-base) < radius2) {
discard;
}
interior = true;
#endif
}
if( end_cap_test > 0.0 )
{
float dNV;
float near;
vec3 end_point;
if ( ortho == 1.0 ) {
end_point = ray_target;
} else {
dNV = dot(axis, ray_direction);
if (dNV < 0.0) {
discard;
}
near = dot(axis, end) / dNV;
end_point = ray_direction * near + ray_origin;
}
if( dot(end_point - end, end_point-base) > radius2 ) {
discard;
}
#ifdef CAP
surface_point = end_point;
_normal = axis;
#else
surface_point = ray_target + ( (-a1 - sqrt(d)) / a2 ) * ray_direction;
dNV = dot(-axis, ray_direction);
near = dot(-axis, (base)) / dNV;
new_point2 = ray_direction * near + ray_origin;
if (dot(new_point2 - base, new_point2-base) < radius2) {
discard;
}
interior = true;
#endif
}
gl_FragDepthEXT = calcDepth( surface_point );
#ifdef NEAR_CLIP
if( calcClip( surface_point ) > 0.0 ){
dist = (-a1 - sqrt(d)) / a2;
surface_point = ray_target + dist * ray_direction;
if( calcClip( surface_point ) > 0.0 ) {
discard;
}
interior = true;
gl_FragDepthEXT = calcDepth( surface_point );
if( gl_FragDepthEXT >= 0.0 ){
gl_FragDepthEXT = max( 0.0, calcDepth( vec3( - ( clipNear - 0.5 ) ) ) + ( 0.0000001 / vRadius ) );
}
}else if( gl_FragDepthEXT <= 0.0 ){
dist = (-a1 - sqrt(d)) / a2;
surface_point = ray_target + dist * ray_direction;
interior = true;
gl_FragDepthEXT = calcDepth( surface_point );
if( gl_FragDepthEXT >= 0.0 ){
gl_FragDepthEXT = 0.0 + ( 0.0000001 / vRadius );
}
}
#else
if( gl_FragDepthEXT <= 0.0 ){
dist = (-a1 - sqrt(d)) / a2;
surface_point = ray_target + dist * ray_direction;
interior = true;
gl_FragDepthEXT = calcDepth( surface_point );
if( gl_FragDepthEXT >= 0.0 ){
gl_FragDepthEXT = 0.0 + ( 0.0000001 / vRadius );
}
}
#endif
if (gl_FragDepthEXT < 0.0) {
discard;
}
if (gl_FragDepthEXT > 1.0) {
discard;
}
#ifdef PICKING
if( opacity < 0.3 )
discard;
gl_FragColor = vec4( vPickingColor, objectId );
#else
vec3 vViewPosition = -surface_point;
vec3 vNormal = _normal;
vec3 vColor;
if( distSq3( surface_point, end ) < distSq3( surface_point, base ) ){
if( b < 0.0 ){
vColor = vColor1;
}else{
vColor = vColor2;
}
}else{
if( b > 0.0 ){
vColor = vColor1;
}else{
vColor = vColor2;
}
}
vec4 diffuseColor = vec4( diffuse, opacity );
ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
vec3 totalEmissiveLight = emissive;
#include color_fragment
#include roughnessmap_fragment
#include metalnessmap_fragment
vec3 normal = normalize( vNormal );
vec3 nonPerturbedNormal = normal;
#include lights_physical_fragment
#include lights_fragment_begin
#include lights_fragment_end
vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveLight;
if( interior ){
#ifdef USE_INTERIOR_COLOR
outgoingLight.xyz = interiorColor;
#else
#ifdef DIFFUSE_INTERIOR
outgoingLight.xyz = vColor;
#endif
#endif
outgoingLight.xyz *= 1.0 - interiorDarkening;
}
gl_FragColor = vec4( outgoingLight, diffuseColor.a );
#include premultiplied_alpha_fragment
#include tonemapping_fragment
#include colorspace_fragment
#include fog_fragment
#endif
}