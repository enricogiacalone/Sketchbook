// Procedural Grass Fragment Shader

varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vBladeHeight;

void main() {
    // --- COLOR ---
    // Base green color for the grass
    vec3 baseColor = vec3(0.1, 0.4, 0.1);
    
    // Make the tips of the grass slightly lighter/yellower
    vec3 tipColor = vec3(0.6, 0.8, 0.2);
    float tipFactor = pow(vBladeHeight, 3.0); // Power to make only the very tips change color
    
    vec3 finalColor = mix(baseColor, tipColor, tipFactor);

    // --- LIGHTING ---
    // Simple directional lighting
    vec3 lightDirection = normalize(vec3(1.0, 1.0, 1.0));
    float diffuse = max(0.0, dot(vNormal, lightDirection));
    
    // Add some ambient light
    float ambientLight = 0.6;
    
    gl_FragColor = vec4(finalColor * (diffuse + ambientLight), 1.0);
}
