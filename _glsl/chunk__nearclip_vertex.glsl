#ifdef NEAR_CLIP
if( vViewPosition.z < clipNear - 5.0 )
gl_Position.z = 2.0 * gl_Position.w;
#endif