#ifdef USE_FOG
float depth = length( vViewPosition );
#ifdef FOG_EXP2
float fogFactor = whiteCompliment( exp2( - fogDensity * fogDensity * depth * depth * LOG2 ) );
#else
float fogFactor = smoothstep( fogNear, fogFar, depth );
#endif
gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif