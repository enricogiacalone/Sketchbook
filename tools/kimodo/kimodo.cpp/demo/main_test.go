package main

import (
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestWriteSkeletonGLB(t *testing.T) {
	for _, skeletonKey := range []string{"smplx22", "soma30", "g1skel34"} {
		t.Run(skeletonKey, func(t *testing.T) {
			skeleton := skeletonDefinitions[skeletonKey]
			path := filepath.Join(t.TempDir(), "animation.glb")
			roots := []float32{0, 0, 0, 1, 0, 0}
			rotations := make([]float32, 2*len(skeleton.parents)*4)
			for frame := 0; frame < 2; frame++ {
				for joint := range skeleton.parents {
					rotations[(frame*len(skeleton.parents)+joint)*4+3] = 1
				}
			}
			if err := writeSkeletonGLB(path, roots, rotations, skeleton); err != nil {
				t.Fatal(err)
			}
			assertSkeletonGLB(t, path, len(skeleton.parents))
		})
	}
}

func assertSkeletonGLB(t *testing.T, path string, expectedJoints int) {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(b) < 20 || binary.LittleEndian.Uint32(b) != 0x46546c67 || binary.LittleEndian.Uint32(b[4:]) != 2 || int(binary.LittleEndian.Uint32(b[8:])) != len(b) {
		t.Fatalf("invalid GLB header")
	}
	jsonLength := int(binary.LittleEndian.Uint32(b[12:]))
	if binary.LittleEndian.Uint32(b[16:]) != 0x4e4f534a || 20+jsonLength > len(b) {
		t.Fatalf("invalid GLB JSON chunk")
	}
	var document struct {
		Asset      map[string]string `json:"asset"`
		Nodes      []json.RawMessage `json:"nodes"`
		Animations []json.RawMessage `json:"animations"`
	}
	if err := json.Unmarshal(b[20:20+jsonLength], &document); err != nil {
		t.Fatal(err)
	}
	if document.Asset["version"] != "2.0" || len(document.Nodes) != expectedJoints || len(document.Animations) != 1 {
		t.Fatalf("unexpected GLB document: %s", b[20:20+jsonLength])
	}
}
