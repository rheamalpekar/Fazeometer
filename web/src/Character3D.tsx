import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { PART_SPECS, SHIP_SPECS, type PartSpec } from "./partSpecs";
import type { CharacterView } from "./api";

const RARITY_GLOW: Record<string, number> = { common: 0, rare: 0.25, epic: 0.5, legendary: 0.9 };

function Geometry({ spec }: { spec: PartSpec }) {
  const [a, b] = spec.size;
  switch (spec.shape) {
    case "box": return <boxGeometry args={spec.size} />;
    case "sphere": return <sphereGeometry args={[a, 24, 16]} />;
    case "cylinder": return <cylinderGeometry args={[a, a, b, 20]} />;
    case "cone": return <coneGeometry args={[a, b, 20]} />;
    case "torus": return <torusGeometry args={[a, b, 10, 32]} />;
  }
}

function Part({ spec, owned, color, rarity, fresh, focused }: { spec: PartSpec; owned: boolean; color: string; rarity: string; fresh: boolean; focused: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const born = useRef<number | null>(null);

  // A newly unlocked part scales in with an overshoot, so the unlock is felt.
  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    if (fresh) {
      if (born.current === null) born.current = state.clock.elapsedTime;
      const t = Math.min((state.clock.elapsedTime - born.current) / 0.9, 1);
      const s = t < 1 ? 1 + Math.sin(t * Math.PI) * 0.7 * (1 - t) * 2 : 1;
      m.scale.setScalar(t === 0 ? 0.01 : Math.max(0.01, t * s));
    } else {
      born.current = null;
      const target = focused ? 1.12 : 1;
      m.scale.setScalar(THREE.MathUtils.lerp(m.scale.x, target, 0.2));
    }
  });

  return (
    <mesh ref={ref} position={spec.pos} rotation={spec.rot ?? [0, 0, 0]}>
      <Geometry spec={spec} />
      {owned ? (
        <meshStandardMaterial color={color} metalness={0.55} roughness={0.35} emissive={color} emissiveIntensity={(RARITY_GLOW[rarity] ?? 0) * (fresh ? 2.5 : 1)} />
      ) : (
        <meshBasicMaterial color="#8b93a7" wireframe transparent opacity={focused ? 0.7 : 0.22} />
      )}
    </mesh>
  );
}

function Mannequin() {
  return (
    <group>
      <mesh position={[0, 1.78, 0]}><sphereGeometry args={[0.2, 24, 16]} /><meshStandardMaterial color="#2b3242" roughness={0.8} /></mesh>
      <mesh position={[0, 1.15, 0]}><boxGeometry args={[0.5, 0.75, 0.24]} /><meshStandardMaterial color="#2b3242" roughness={0.8} /></mesh>
      {[-0.36, 0.36].map((x) => (
        <mesh key={x} position={[x, 1.1, 0]}><cylinderGeometry args={[0.07, 0.07, 0.8, 12]} /><meshStandardMaterial color="#2b3242" roughness={0.8} /></mesh>
      ))}
      {[-0.14, 0.14].map((x) => (
        <mesh key={x} position={[x, 0.4, 0]}><cylinderGeometry args={[0.08, 0.08, 0.8, 12]} /><meshStandardMaterial color="#2b3242" roughness={0.8} /></mesh>
      ))}
    </group>
  );
}

export function Character3D({ view, freshIds, focusPosition }: { view: CharacterView; freshIds: Set<string>; focusPosition: number | null }) {
  const ship = view.kind === "ship";
  const specs = ship ? SHIP_SPECS : PART_SPECS;
  return (
    <Canvas camera={{ position: ship ? [2.6, 2.1, 6.4] : [0, 1.5, 7], fov: 40 }} dpr={[1, 2]}>
      <color attach="background" args={["#0b0e14"]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 5, 4]} intensity={1.6} />
      <directionalLight position={[-4, 2, -3]} intensity={0.6} color="#C8102E" />
      <group position={[0, ship ? -0.5 : -0.9, 0]}>
        {ship ? (
          <mesh position={[0, -0.4, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[3.6, 48]} />
            <meshStandardMaterial color="#0e4256" roughness={0.4} metalness={0.2} transparent opacity={0.65} />
          </mesh>
        ) : (
          <Mannequin />
        )}
        {view.parts.map((p) => {
          const spec = specs[p.position];
          return spec ? (
            <Part key={p.id} spec={spec} owned={p.owned} color={spec.color ?? view.color} rarity={p.rarity} fresh={freshIds.has(p.id)} focused={focusPosition === p.position} />
          ) : null;
        })}
        <ContactShadows position={[0, 0, 0]} opacity={0.5} scale={6} blur={2.4} far={2} />
      </group>
      <OrbitControls enablePan={false} minDistance={3} maxDistance={ship ? 13 : 8} target={[0, ship ? 1.2 : 1, 0]} autoRotate autoRotateSpeed={0.9} />
    </Canvas>
  );
}
