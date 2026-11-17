import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import * as THREE from "three";

const GOLD = "#d9a441";
const GOLD_BRIGHT = "#f0cf8a";
const CRIMSON = "#b3202f";
const WOOD = "#8a5a30";

/** Height of the sea surface at a world position. The ship and the water share this so the hull rides the swell. */
export const waveH = (x: number, z: number, t: number) =>
  0.18 * Math.sin(0.6 * x + t * 0.9) + 0.12 * Math.sin(0.8 * z + t * 1.3) + 0.08 * Math.sin(0.35 * (x + z) + t * 0.7);

function Sea({ y = -0.1 }: { y?: number }) {
  const geo = useRef<THREE.PlaneGeometry>(null);
  useFrame(({ clock }) => {
    const g = geo.current;
    if (!g) return;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const t = clock.elapsedTime;
    // The plane is rotated flat, so local (x, -y) is the world (x, z) and local z is height.
    for (let i = 0; i < pos.count; i++) pos.setZ(i, waveH(pos.getX(i), -pos.getY(i), t));
    pos.needsUpdate = true;
    g.computeVertexNormals();
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]}>
      <planeGeometry ref={geo} args={[120, 120, 90, 90]} />
      <meshStandardMaterial color="#14607a" roughness={0.3} metalness={0.2} flatShading />
    </mesh>
  );
}

function Moon() {
  return (
    <group position={[-16, 10, -38]}>
      <mesh>
        <sphereGeometry args={[2.4, 32, 24]} />
        <meshBasicMaterial color="#f3eedb" fog={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[3.4, 32, 24]} />
        <meshBasicMaterial color="#9db7d8" transparent opacity={0.12} fog={false} />
      </mesh>
    </group>
  );
}

function Islands() {
  return (
    <group>
      {[[-22, -42, 7, 4], [-12, -46, 5, 3], [26, -50, 9, 5], [14, -44, 4, 2.5]].map(([x, z, h, r], i) => (
        <mesh key={i} position={[x, h / 2 - 0.5, z]}>
          <coneGeometry args={[r, h, 7]} />
          <meshStandardMaterial color="#0a1620" roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  );
}

/** Agamemnon: bronze-and-gold king of Mycenae, built from primitives. Roughly 1.6 units tall. */
export function Agamemnon({ position = [0, 0, 0], scale = 1, rotationY = 0 }: { position?: [number, number, number]; scale?: number; rotationY?: number }) {
  const cape = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (cape.current) cape.current.rotation.x = 0.12 + Math.sin(clock.elapsedTime * 1.6) * 0.07;
  });
  const gold = { color: GOLD, metalness: 0.85, roughness: 0.3 } as const;
  const skin = { color: "#c89a72", roughness: 0.8 } as const;
  return (
    <group position={position} scale={scale} rotation={[0, rotationY, 0]}>
      {/* legs and greaves */}
      {[-0.08, 0.08].map((x) => (
        <group key={x}>
          <mesh position={[x, 0.28, 0]}><cylinderGeometry args={[0.055, 0.05, 0.56, 12]} /><meshStandardMaterial {...skin} /></mesh>
          <mesh position={[x, 0.2, 0.01]}><cylinderGeometry args={[0.07, 0.062, 0.3, 12]} /><meshStandardMaterial {...gold} /></mesh>
          <mesh position={[x, 0.03, 0.04]}><boxGeometry args={[0.1, 0.05, 0.2]} /><meshStandardMaterial color="#4a2e18" roughness={0.9} /></mesh>
        </group>
      ))}
      {/* pteruges skirt with a gold band */}
      <mesh position={[0, 0.66, 0]}><cylinderGeometry args={[0.17, 0.25, 0.24, 18]} /><meshStandardMaterial color={CRIMSON} roughness={0.7} /></mesh>
      <mesh position={[0, 0.77, 0]}><cylinderGeometry args={[0.175, 0.175, 0.04, 18]} /><meshStandardMaterial {...gold} /></mesh>
      {/* cuirass */}
      <mesh position={[0, 0.97, 0]}><cylinderGeometry args={[0.2, 0.16, 0.42, 18]} /><meshStandardMaterial {...gold} /></mesh>
      <mesh position={[0, 1.03, 0.16]}><sphereGeometry args={[0.04, 12, 10]} /><meshStandardMaterial color={CRIMSON} roughness={0.5} /></mesh>
      {/* shoulders, arms */}
      {[-0.23, 0.23].map((x) => <mesh key={x} position={[x, 1.14, 0]}><sphereGeometry args={[0.09, 14, 12]} /><meshStandardMaterial {...gold} /></mesh>)}
      <mesh position={[-0.27, 0.95, 0.04]} rotation={[0, 0, 0.1]}><cylinderGeometry args={[0.045, 0.04, 0.38, 10]} /><meshStandardMaterial {...skin} /></mesh>
      <mesh position={[0.3, 1.1, 0.06]} rotation={[0.1, 0, -0.35]}><cylinderGeometry args={[0.045, 0.04, 0.34, 10]} /><meshStandardMaterial {...skin} /></mesh>
      {/* head, beard, helmet, crest */}
      <mesh position={[0, 1.33, 0]}><sphereGeometry args={[0.115, 20, 16]} /><meshStandardMaterial {...skin} /></mesh>
      <mesh position={[0, 1.26, 0.07]} scale={[1, 1.1, 0.7]}><sphereGeometry args={[0.085, 14, 12]} /><meshStandardMaterial color="#2a1a10" roughness={1} /></mesh>
      <mesh position={[0, 1.37, 0]}><sphereGeometry args={[0.13, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.55]} /><meshStandardMaterial {...gold} /></mesh>
      <mesh position={[0, 1.34, 0.115]}><boxGeometry args={[0.03, 0.12, 0.02]} /><meshStandardMaterial {...gold} /></mesh>
      <mesh position={[0, 1.52, -0.02]}><boxGeometry args={[0.03, 0.15, 0.3]} /><meshStandardMaterial color={CRIMSON} roughness={0.6} /></mesh>
      {/* cape */}
      <mesh ref={cape} position={[0, 0.95, -0.2]}><boxGeometry args={[0.36, 0.7, 0.02]} /><meshStandardMaterial color={CRIMSON} roughness={0.8} side={THREE.DoubleSide} /></mesh>
      {/* spear raised in the right hand */}
      <mesh position={[0.36, 1.05, 0.08]}><cylinderGeometry args={[0.014, 0.014, 1.7, 8]} /><meshStandardMaterial color="#8a5a2b" roughness={0.8} /></mesh>
      <mesh position={[0.36, 1.97, 0.08]}><coneGeometry args={[0.035, 0.18, 8]} /><meshStandardMaterial {...gold} /></mesh>
      {/* round shield on the left arm */}
      <group position={[-0.34, 0.92, 0.12]} rotation={[0, 0.35, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.24, 0.24, 0.04, 28]} /><meshStandardMaterial color={CRIMSON} roughness={0.6} /></mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.24, 0.018, 8, 36]} /><meshStandardMaterial {...gold} /></mesh>
        <mesh position={[0, 0, 0.03]}><sphereGeometry args={[0.05, 12, 10]} /><meshStandardMaterial {...gold} /></mesh>
      </group>
    </group>
  );
}

/** A Greek trireme with a billowing crimson sail, rowing oars, a row of shields and an optional Agamemnon at the bow. */
export function Ship({ figure = true, position = [0, 0, 0], scale = 1, rotationY = 0 }: { figure?: boolean; position?: [number, number, number]; scale?: number; rotationY?: number }) {
  const grp = useRef<THREE.Group>(null);
  const sail = useRef<THREE.PlaneGeometry>(null);
  const oars = useRef<(THREE.Group | null)[]>([]);
  const oarSlots = useMemo(() => [-1.4, -0.7, 0, 0.7, 1.4].flatMap((x) => [{ x, side: -1 }, { x, side: 1 }]), []);
  const shieldXs = useMemo(() => [-1.6, -1.2, -0.8, -0.4, 0, 0.4, 0.8, 1.2, 1.6], []);

  const hullGeo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-2.3, 0.65);
    s.bezierCurveTo(-2.15, 0.05, -1.6, -0.35, -0.8, -0.35);
    s.lineTo(1.0, -0.35);
    s.bezierCurveTo(1.9, -0.3, 2.4, 0.3, 2.75, 1.2);
    s.bezierCurveTo(2.35, 0.95, 2.0, 0.72, 1.6, 0.65);
    s.lineTo(-2.3, 0.65);
    const g = new THREE.ExtrudeGeometry(s, { depth: 1.0, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2, curveSegments: 18 });
    g.translate(0, 0, -0.5);
    return g;
  }, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const g = grp.current;
    if (g) {
      g.position.set(position[0], position[1] + waveH(position[0], position[2], t) * 0.9 + 0.05, position[2]);
      g.rotation.set(Math.sin(t * 1.3 + 1) * 0.03, rotationY, Math.sin(t * 0.9) * 0.045);
    }
    const sg = sail.current;
    if (sg) {
      const p = sg.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i) / 2.2 + 0.5;
        p.setZ(i, Math.sin(u * Math.PI) * (0.3 + 0.06 * Math.sin(t * 1.2 + p.getY(i))));
      }
      p.needsUpdate = true;
      sg.computeVertexNormals();
    }
    oarSlots.forEach((o, i) => {
      const og = oars.current[i];
      if (og) og.rotation.x = o.side * (Math.PI / 2 + 0.5 + Math.sin(t * 1.5 + i * 0.35) * 0.14);
    });
  });

  return (
    <group ref={grp} position={position} scale={scale}>
      <mesh geometry={hullGeo}><meshStandardMaterial color={WOOD} roughness={0.75} /></mesh>
      <mesh position={[0.2, 0.62, 0]}><boxGeometry args={[4.3, 0.05, 0.92]} /><meshStandardMaterial color="#a9793f" roughness={0.8} /></mesh>
      {/* gold gunwale trim */}
      {[-0.5, 0.5].map((z) => <mesh key={z} position={[-0.1, 0.66, z]}><boxGeometry args={[4.4, 0.06, 0.05]} /><meshStandardMaterial color={GOLD} metalness={0.8} roughness={0.35} /></mesh>)}
      {/* prow ornament and stern post */}
      <mesh position={[2.7, 1.22, 0]}><sphereGeometry args={[0.15, 16, 12]} /><meshStandardMaterial color={GOLD} metalness={0.85} roughness={0.3} /></mesh>
      <mesh position={[-2.3, 1.0, 0]} rotation={[0, 0, 0.3]}><coneGeometry args={[0.1, 0.7, 8]} /><meshStandardMaterial color={GOLD} metalness={0.85} roughness={0.3} /></mesh>
      {/* shields along both sides */}
      {[-1, 1].flatMap((side) =>
        shieldXs.map((x, i) => (
          <mesh key={`${side}${x}`} position={[x, 0.82, side * 0.56]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.17, 0.17, 0.03, 18]} />
            <meshStandardMaterial color={i % 2 ? CRIMSON : GOLD} metalness={0.5} roughness={0.5} />
          </mesh>
        )),
      )}
      {/* mast, yard, sail with sun emblem */}
      <mesh position={[0, 2.15, 0]}><cylinderGeometry args={[0.06, 0.08, 3.1, 10]} /><meshStandardMaterial color="#5a3a1c" roughness={0.9} /></mesh>
      <group rotation={[0, Math.PI / 2, 0]}>
        <mesh position={[0, 3.3, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.045, 0.045, 2.5, 8]} /><meshStandardMaterial color="#5a3a1c" roughness={0.9} /></mesh>
        <mesh position={[0, 2.3, 0]}>
          <planeGeometry ref={sail} args={[2.2, 1.9, 14, 10]} />
          <meshStandardMaterial color={CRIMSON} roughness={0.85} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 2.3, 0.3]}><circleGeometry args={[0.32, 24]} /><meshBasicMaterial color={GOLD_BRIGHT} side={THREE.DoubleSide} /></mesh>
      </group>
      {/* oars */}
      {oarSlots.map((o, i) => (
        <group key={i} ref={(el) => { oars.current[i] = el; }} position={[o.x, 0.5, o.side * 0.52]}>
          <mesh position={[0, 0.9, 0]}><cylinderGeometry args={[0.02, 0.02, 1.8, 6]} /><meshStandardMaterial color="#a9793f" roughness={0.8} /></mesh>
        </group>
      ))}
      <pointLight position={[-2.1, 1.3, 0]} color="#ffb347" intensity={2.2} distance={7} />
      <mesh position={[-2.1, 1.3, 0]}><sphereGeometry args={[0.06, 10, 8]} /><meshBasicMaterial color="#ffd89a" /></mesh>
      {figure && <Agamemnon position={[1.55, 0.65, 0]} scale={0.9} rotationY={Math.PI / 2} />}
    </group>
  );
}

function Rig() {
  const { camera, size } = useThree();
  const mouse = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const on = (e: PointerEvent) => { mouse.current = { x: (e.clientX / window.innerWidth) * 2 - 1, y: -((e.clientY / window.innerHeight) * 2 - 1) }; };
    window.addEventListener("pointermove", on);
    return () => window.removeEventListener("pointermove", on);
  }, []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const tx = 3.2 + mouse.current.x * 1.3 + Math.sin(t * 0.15) * 0.7;
    const ty = 2.4 + mouse.current.y * 0.4;
    // On a tall phone screen the ship sits in the upper half, above the headline.
    const narrow = size.width / size.height < 1;
    const tz = narrow ? 15 : 11;
    camera.position.x += (tx - camera.position.x) * 0.03;
    camera.position.y += (ty - camera.position.y) * 0.03;
    camera.position.z += (tz - camera.position.z) * 0.05;
    if (narrow) camera.lookAt(-0.4, -1.1, 0);
    else camera.lookAt(-5.4, 1.5, 0);
  });
  return null;
}

/** Full-bleed hero: night sea, moon, distant Ithaca, the ship with Agamemnon at the bow. */
export function LandingScene() {
  return (
    <Canvas camera={{ position: [3.2, 2.4, 11], fov: 42 }} dpr={[1, 1.8]}>
      <color attach="background" args={["#050a12"]} />
      <fog attach="fog" args={["#07111d", 12, 60]} />
      <hemisphereLight args={["#9db7d8", "#10283a", 0.9]} />
      <directionalLight position={[-10, 9, -6]} intensity={2.2} color="#dfe9ff" />
      <directionalLight position={[6, 5, 8]} intensity={1.3} color="#ffd9a0" />
      <pointLight position={[3, 3, 3]} intensity={1.6} color="#ffb766" />
      <Stars radius={90} depth={30} count={2500} factor={4} fade speed={0.4} />
      <Moon />
      <Islands />
      <Sea />
      <Ship rotationY={-0.8} />
      <Rig />
    </Canvas>
  );
}

/** The legend preview: a finished hero, Agamemnon on a marble plinth with the fleet sailing behind. */
export function LegendScene() {
  return (
    <Canvas camera={{ position: [0, 2, 6.2], fov: 38 }} dpr={[1, 2]}>
      <color attach="background" args={["#070d17"]} />
      <fog attach="fog" args={["#09131f", 9, 45]} />
      <ambientLight intensity={0.5} color="#9db7d8" />
      <directionalLight position={[4, 6, 5]} intensity={1.4} color="#ffe2b0" />
      <pointLight position={[-3, 2.5, 2]} intensity={1.4} color="#ffb766" />
      <Stars radius={80} depth={30} count={1800} factor={3.5} fade speed={0.3} />
      <Sea y={-0.9} />
      <mesh position={[0, -0.15, 0]}>
        <cylinderGeometry args={[1.1, 1.25, 0.3, 32]} />
        <meshStandardMaterial color="#d8cfb8" roughness={0.6} />
      </mesh>
      <Agamemnon position={[0, 0, 0]} scale={2.1} rotationY={0.3} />
      <Ship figure={false} position={[-9, -0.85, -12]} scale={1.3} rotationY={0.5} />
      <Ship figure={false} position={[11, -0.85, -16]} scale={1.1} rotationY={-0.4} />
      <OrbitControls enablePan={false} minDistance={3.5} maxDistance={9} target={[0, 1.7, 0]} autoRotate autoRotateSpeed={1.1} maxPolarAngle={Math.PI / 2 - 0.05} />
    </Canvas>
  );
}
