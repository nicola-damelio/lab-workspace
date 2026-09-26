
uniform float clipNear;
uniform vec3 clipCenter;
uniform float linewidth;
uniform vec2 resolution;
uniform mat4 projectionMatrixInverse;
attribute vec2 mapping;
attribute vec3 position1;
attribute vec3 position2;
#ifdef PICKING
#include unpack_color
attribute float primitiveId;
varying vec3 vPickingColor;
#else
attribute vec3 color2;
varying vec3 vColor;
varying vec3 vColor2;
varying float flag;
varying vec3 vViewPosition;
#endif
#if defined( RADIUS_CLIP )
varying vec3 vClipCenter;
#endif
void trimSegment( const in vec4 start, inout vec4 end ) {
float a = projectionMatrix[ 2 ][ 2 ]; float b = projectionMatrix[ 3 ][ 2 ]; float nearEstimate = - 0.5 * b / a;
float alpha = ( nearEstimate - start.z ) / ( end.z - start.z );
end.xyz = mix( start.xyz, end.xyz, alpha );
}
void main() {
float aspect = resolution.x / resolution.y;
#ifdef PICKING
vPickingColor = unpackColor( primitiveId );
#else
flag = mapping.y;
vColor = color;
vColor2 = color2;
#endif
vec4 start = modelViewMatrix * vec4( position1, 1.0 );
vec4 end = modelViewMatrix * vec4( position2, 1.0 );
bool perspective = ( projectionMatrix[ 2 ][ 3 ] == -1.0 ); if ( perspective ) {
if ( start.z < 0.0 && end.z >= 0.0 ) {
trimSegment( start, end );
} else if ( end.z < 0.0 && start.z >= 0.0 ) {
trimSegment( end, start );
}
}
vec4 clipStart = projectionMatrix * start;
vec4 clipEnd = projectionMatrix * end;
vec2 ndcStart = clipStart.xy / clipStart.w;
vec2 ndcEnd = clipEnd.xy / clipEnd.w;
vec2 dir = ndcEnd - ndcStart;
dir.x *= aspect;
dir = normalize( dir );
vec2 offset = vec2( dir.y, - dir.x );
dir.x /= aspect;
offset.x /= aspect;
if ( mapping.x < 0.0 ) offset *= - 1.0;
offset *= linewidth;
offset /= resolution.y;
vec4 clip = ( mapping.y < 0.5 ) ? clipStart : clipEnd;
offset *= clip.w;
clip.xy += offset;
gl_Position = clip;
#ifndef PICKING
vViewPosition = ( projectionMatrixInverse * clip ).xyz;
#endif
#if defined( RADIUS_CLIP )
vClipCenter = -( modelViewMatrix * vec4( clipCenter, 1.0 ) ).xyz;
#endif
#include nearclip_vertex
}