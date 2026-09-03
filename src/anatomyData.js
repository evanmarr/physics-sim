// A simplified, diagram-style human body: one shared coordinate space
// (viewBox "0 0 300 680"), with each body system's organs as simple shapes
// (ellipses/rects/paths) positioned at roughly the right anatomical spot.
// This is a schematic teaching diagram, not a medical illustration — the
// same tradeoff as any basic anatomy poster.

export const VIEWBOX = "0 0 300 680";

export const SYSTEMS = [
  { id: "skin", label: "Integumentary (Skin)", color: "#d8a67a" },
  { id: "skeletal", label: "Skeletal", color: "#e8e4d8" },
  { id: "muscular", label: "Muscular", color: "#c0473f" },
  { id: "cardiovascular", label: "Cardiovascular", color: "#d1293d" },
  { id: "respiratory", label: "Respiratory", color: "#5fa8d3" },
  { id: "digestive", label: "Digestive", color: "#c9932f" },
  { id: "nervous", label: "Nervous", color: "#f2c744" },
];

// The neutral silhouette shown faintly behind whichever system is active,
// for spatial context. Shared by every system.
export const BODY_OUTLINE = [
  { tag: "circle", cx: 150, cy: 70, r: 42 },
  { tag: "rect", x: 138, y: 105, width: 24, height: 22, rx: 6 },
  { tag: "path", d: "M100,125 L200,125 L215,330 L85,330 Z" },
  { tag: "rect", x: 55, y: 130, width: 24, height: 100, rx: 10 },
  { tag: "rect", x: 50, y: 230, width: 22, height: 90, rx: 10 },
  { tag: "ellipse", cx: 60, cy: 335, rx: 14, ry: 18 },
  { tag: "rect", x: 221, y: 130, width: 24, height: 100, rx: 10 },
  { tag: "rect", x: 228, y: 230, width: 22, height: 90, rx: 10 },
  { tag: "ellipse", cx: 240, cy: 335, rx: 14, ry: 18 },
  { tag: "path", d: "M85,330 L215,330 L200,380 L100,380 Z" },
  { tag: "rect", x: 95, y: 380, width: 40, height: 140, rx: 14 },
  { tag: "rect", x: 100, y: 520, width: 30, height: 120, rx: 12 },
  { tag: "ellipse", cx: 112, cy: 655, rx: 22, ry: 12 },
  { tag: "rect", x: 165, y: 380, width: 40, height: 140, rx: 14 },
  { tag: "rect", x: 170, y: 520, width: 30, height: 120, rx: 12 },
  { tag: "ellipse", cx: 188, cy: 655, rx: 22, ry: 12 },
];

function organ(id, name, system, shape, fn, facts, extra = {}) {
  return { id, name, system, shape, function: fn, facts, ...extra };
}

export const ORGANS = [
  // ---- Skin ----
  organ("skin-body", "Skin", "skin",
    { tag: "g", shapes: BODY_OUTLINE },
    "The body's largest organ — a waterproof, self-repairing barrier that regulates temperature, senses touch/pressure/pain, and blocks pathogens and UV radiation.",
    [
      "Skin makes up about 16% of your total body weight.",
      "You shed roughly 30,000–40,000 dead skin cells every minute.",
      "Skin fully replaces itself about once a month.",
    ]),

  // ---- Skeletal ----
  organ("skull", "Skull", "skeletal", { tag: "circle", cx: 150, cy: 70, r: 38 },
    "Protects the brain and supports the structures of the face; also anchors the jaw for chewing.",
    ["The skull is made of 22 individual bones fused together.", "Newborn skulls have soft gaps called fontanelles that let the brain grow.", "The jawbone (mandible) is the only skull bone that can move."]),
  organ("spine", "Spine (Vertebral Column)", "skeletal", { tag: "rect", x: 146, y: 105, width: 8, height: 225, rx: 3 },
    "Protects the spinal cord and supports the body's weight while allowing it to bend and twist.",
    ["The spine has 33 vertebrae, though 9 fuse together in adulthood.", "Discs between vertebrae compress during the day — you're measurably taller in the morning.", "The spine's S-curve is what lets it absorb shock while walking or running."]),
  organ("ribcage", "Ribcage", "skeletal", { tag: "ellipse", cx: 150, cy: 180, rx: 55, ry: 70, fillOpacity: 0.35 },
    "A protective cage around the heart and lungs that also assists breathing by expanding and contracting.",
    ["Most people have 12 pairs of ribs — 24 total.", "About 1 in 200 people are born with an extra rib.", "The lower two rib pairs are called \"floating ribs\" since they don't attach to the sternum."]),
  organ("pelvis-bone", "Pelvis", "skeletal", { tag: "path", d: "M100,330 L200,330 L185,375 L115,375 Z" },
    "Supports the spine's weight, anchors the leg bones, and protects the lower abdominal organs.",
    ["The pelvis is actually three fused bones: the ilium, ischium, and pubis.", "The female pelvis is typically wider to allow for childbirth.", "It's one of the last bones to finish growing, often not fully fused until the mid-20s."]),
  organ("humerus-l", "Humerus (Upper Arm Bone)", "skeletal", { tag: "rect", x: 58, y: 135, width: 10, height: 85, rx: 4 },
    "The single long bone of the upper arm, connecting the shoulder to the elbow.",
    ["It's the largest bone in the arm.", "The \"funny bone\" feeling comes from hitting the ulnar nerve near the humerus, not the bone itself.", "It's one of the most commonly fractured long bones in falls."]),
  organ("humerus-r", "Humerus (Upper Arm Bone)", "skeletal", { tag: "rect", x: 232, y: 135, width: 10, height: 85, rx: 4 },
    "The single long bone of the upper arm, connecting the shoulder to the elbow.",
    ["It's the largest bone in the arm.", "The \"funny bone\" feeling comes from hitting the ulnar nerve near the humerus, not the bone itself.", "It's one of the most commonly fractured long bones in falls."]),
  organ("femur-l", "Femur (Thigh Bone)", "skeletal", { tag: "rect", x: 105, y: 385, width: 12, height: 130, rx: 5 },
    "The longest, strongest bone in the body, connecting the hip to the knee.",
    ["The femur can bear up to 30 times a person's body weight.", "It's about a quarter of a person's total height.", "It's one of the last bones to be identified in forensic investigations because of how durable it is."]),
  organ("femur-r", "Femur (Thigh Bone)", "skeletal", { tag: "rect", x: 183, y: 385, width: 12, height: 130, rx: 5 },
    "The longest, strongest bone in the body, connecting the hip to the knee.",
    ["The femur can bear up to 30 times a person's body weight.", "It's about a quarter of a person's total height.", "It's one of the last bones to be identified in forensic investigations because of how durable it is."]),

  // ---- Muscular ----
  organ("pectorals", "Pectoral Muscles", "muscular", { tag: "ellipse", cx: 150, cy: 160, rx: 48, ry: 28 },
    "The chest muscles that move the shoulder and arm — pulling the arm across the body and rotating it inward.",
    ["The pectoralis major is one of the largest muscles in the upper body.", "It's actively used in pushing motions like a push-up or bench press.", "Beneath it sits the smaller pectoralis minor, which helps stabilize the shoulder blade."]),
  organ("abs", "Abdominal Muscles", "muscular", { tag: "rect", x: 125, y: 220, width: 50, height: 90, rx: 8 },
    "Support the spine, control posture, and assist breathing and core movement.",
    ["The \"six-pack\" look comes from tendinous bands crossing the rectus abdominis.", "Abs are engaged in almost every full-body movement, not just crunches.", "They play a key role in forceful exhales, like coughing or blowing out candles."]),
  organ("biceps-l", "Biceps", "muscular", { tag: "ellipse", cx: 64, cy: 175, rx: 14, ry: 35 },
    "Flexes the elbow and rotates the forearm — the classic \"make a muscle\" muscle.",
    ["\"Biceps\" already means \"two heads\" in Latin, referring to its two points of origin.", "It's a relatively small muscle compared to its triceps counterpart, which does more of the arm's pushing work.", "It also helps supinate the forearm — turning the palm upward."]),
  organ("biceps-r", "Biceps", "muscular", { tag: "ellipse", cx: 236, cy: 175, rx: 14, ry: 35 },
    "Flexes the elbow and rotates the forearm — the classic \"make a muscle\" muscle.",
    ["\"Biceps\" already means \"two heads\" in Latin, referring to its two points of origin.", "It's a relatively small muscle compared to its triceps counterpart, which does more of the arm's pushing work.", "It also helps supinate the forearm — turning the palm upward."]),
  organ("quads-l", "Quadriceps", "muscular", { tag: "ellipse", cx: 115, cy: 450, rx: 22, ry: 60 },
    "A group of four muscles on the front of the thigh that straighten the knee and are essential for standing, walking, and jumping.",
    ["It's the largest and one of the strongest muscle groups in the human body.", "It's actually four separate muscles working as one: rectus femoris and three vastus muscles.", "Cyclists and sprinters develop especially large quadriceps from repeated extension."]),
  organ("quads-r", "Quadriceps", "muscular", { tag: "ellipse", cx: 185, cy: 450, rx: 22, ry: 60 },
    "A group of four muscles on the front of the thigh that straighten the knee and are essential for standing, walking, and jumping.",
    ["It's the largest and one of the strongest muscle groups in the human body.", "It's actually four separate muscles working as one: rectus femoris and three vastus muscles.", "Cyclists and sprinters develop especially large quadriceps from repeated extension."]),

  // ---- Cardiovascular ----
  organ("heart", "Heart", "cardiovascular",
    { tag: "path", d: "M138,193 C138,193 111,175 111,153 C111,140 122,133 133,140 C136,142 138,146 138,150 C138,146 140,142 143,140 C154,133 165,140 165,153 C165,175 138,193 138,193 Z" },
    "A four-chambered muscular pump that circulates blood, delivering oxygen and nutrients to every cell in the body.",
    ["An average heart beats about 100,000 times a day.", "It pumps roughly 2,000 gallons (7,500 liters) of blood daily.", "It sits slightly left of center, which is why we say \"heart on the left.\""],
    { isolatable: true }),
  organ("aorta", "Aorta & Major Vessels", "cardiovascular", { tag: "path", d: "M138,150 C138,120 148,110 150,100 M138,200 C130,240 128,270 130,300", strokeOnly: true },
    "The aorta is the body's largest artery, carrying oxygen-rich blood from the heart out to the rest of the body.",
    ["The aorta is roughly the diameter of a garden hose in adults.", "Blood travels through the entire circulatory system in about one minute.", "Laid end to end, all the blood vessels in an adult body would stretch about 60,000 miles."]),

  // ---- Respiratory ----
  organ("trachea", "Trachea (Windpipe)", "respiratory", { tag: "rect", x: 146, y: 108, width: 8, height: 25, rx: 3 },
    "Carries air between the throat and the lungs, kept open by rings of cartilage.",
    ["The trachea splits into two bronchi, one for each lung.", "Its cartilage rings are C-shaped, not full circles, to let the esophagus expand behind it during swallowing.", "Coughing can expel air through it at speeds over 50 mph."]),
  organ("lung-l", "Left Lung", "respiratory",
    { tag: "path", d: "M112,120 C88,124 80,155 83,190 C85,215 95,230 113,227 C122,225 126,205 124,175 C126,150 124,128 118,121 C116,119 114,119 112,120 Z" },
    "Draws in oxygen and expels carbon dioxide — the left lung is slightly smaller to make room for the heart.",
    ["The left lung has two lobes; the right has three.", "Fully inflated, both lungs together hold about 6 liters of air.", "Lungs contain around 300–500 million tiny air sacs called alveoli."]),
  organ("lung-r", "Right Lung", "respiratory",
    { tag: "path", d: "M188,120 C212,124 220,155 217,190 C215,215 205,230 187,227 C178,225 174,205 176,175 C174,150 176,128 182,121 C184,119 186,119 188,120 Z" },
    "Draws in oxygen and expels carbon dioxide — the right lung is slightly larger, with an extra lobe.",
    ["The right lung has three lobes; the left has two.", "Laid flat, the total surface area of both lungs' alveoli is roughly the size of a tennis court.", "You breathe about 20,000 times a day without thinking about it."]),

  // ---- Digestive ----
  organ("stomach", "Stomach", "digestive",
    { tag: "path", d: "M108,222 C106,214 112,208 122,208 C134,208 144,214 146,224 C148,233 144,240 136,244 C142,250 138,258 128,258 C116,258 106,250 105,240 C104,233 107,227 108,222 Z" },
    "A muscular sac that churns food with acid and enzymes, breaking it down before it moves to the small intestine.",
    ["Stomach acid is strong enough to dissolve metal — the stomach lining just regenerates fast enough to keep up.", "An empty stomach is about the size of a fist; it can expand to hold roughly a liter of food.", "It replaces its entire lining every 3–4 days to avoid digesting itself."]),
  organ("liver", "Liver", "digestive",
    { tag: "path", d: "M148,208 C158,200 195,200 208,210 C218,218 218,232 208,238 C192,247 162,246 150,236 C142,229 142,215 148,208 Z" },
    "Filters blood, processes nutrients, produces bile for digestion, and neutralizes toxins.",
    ["The liver is the only internal organ that can regrow — it can regenerate from as little as 25% of its original mass.", "It performs over 500 distinct functions in the body.", "It's the largest internal organ, weighing around 3 pounds in adults."]),
  organ("intestines", "Intestines", "digestive", { tag: "ellipse", cx: 150, cy: 290, rx: 45, ry: 35 },
    "Absorb nutrients and water from digested food and compact remaining waste for elimination.",
    ["The small intestine alone is roughly 20 feet long, coiled to fit inside the abdomen.", "Its inner surface, covered in tiny finger-like villi, has an absorption area close to a badminton court.", "Trillions of gut bacteria live here, helping digest food the body can't break down alone."]),

  // ---- Nervous ----
  organ("brain", "Brain", "nervous", { tag: "circle", cx: 150, cy: 65, r: 36 },
    "The command center of the nervous system, coordinating thought, movement, senses, and every involuntary process that keeps the body alive.",
    ["The brain uses about 20% of the body's total energy despite being only ~2% of its weight.", "It contains roughly 86 billion neurons.", "The brain itself has no pain receptors — brain surgery can be done while a patient is awake and feels nothing in the brain tissue."],
    { isolatable: true }),
  organ("spinal-cord", "Spinal Cord", "nervous", { tag: "rect", x: 147, y: 103, width: 6, height: 230, rx: 2 },
    "A thick bundle of nerve fibers running through the spine that relays signals between the brain and the rest of the body.",
    ["It's only about as wide as a finger, yet carries virtually all communication between brain and body.", "Simple reflexes, like pulling a hand off something hot, are processed in the spinal cord before the brain even registers pain.", "It stops growing in length around age 4, even though the spine keeps growing."]),
];

export function organById(id) {
  return ORGANS.find((o) => o.id === id);
}

export function organsForSystem(systemId) {
  return ORGANS.filter((o) => o.system === systemId);
}

// ---- Brain detail view ----
// A separate, larger side-profile scene used when the brain is isolated.
export const BRAIN_VIEWBOX = "0 0 400 320";

export const BRAIN_PARTS_LOBES = [
  { id: "frontal", name: "Frontal Lobe", hemisphere: "both", shape: { tag: "path", d: "M60,140 C60,90 110,55 175,55 C210,55 230,75 235,110 L235,170 L110,185 C75,180 60,165 60,140 Z" },
    function: "Governs reasoning, planning, problem-solving, voluntary movement, and much of personality and impulse control.",
    facts: ["It's the largest of the brain's lobes.", "It's the last brain region to fully mature, often not finishing development until the mid-20s.", "Damage here (famously in the case of Phineas Gage) can dramatically alter personality without affecting intelligence."] },
  { id: "parietal", name: "Parietal Lobe", hemisphere: "both", shape: { tag: "path", d: "M235,90 C270,90 295,105 300,130 L290,175 L235,170 Z" },
    function: "Processes touch, temperature, pain, and spatial awareness — how the body's position relates to the world around it.",
    facts: ["It helps integrate sensory information from multiple sources at once, like sight and touch.", "It plays a major role in hand-eye coordination.", "Damage to it can cause difficulty recognizing objects by touch alone."] },
  { id: "temporal", name: "Temporal Lobe", hemisphere: "both", shape: { tag: "ellipse", cx: 200, cy: 190, rx: 55, ry: 30 },
    function: "Processes sound and language comprehension, and plays a central role in forming and recalling memories.",
    facts: ["It houses the hippocampus, critical for forming new long-term memories.", "It's where language comprehension (Wernicke's area) primarily happens.", "Temporal lobe seizures can sometimes cause vivid, dreamlike hallucinations."] },
  { id: "occipital", name: "Occipital Lobe", hemisphere: "both", shape: { tag: "ellipse", cx: 300, cy: 150, rx: 32, ry: 38 },
    function: "The brain's primary visual processing center — it interprets signals from the eyes into the images we actually perceive.",
    facts: ["It's located at the very back of the brain, farthest from the eyes themselves.", "Damage here can cause blindness even with perfectly healthy eyes.", "It's smaller in humans than the frontal lobe, unlike in many animals more reliant on vision."] },
  { id: "cerebellum", name: "Cerebellum", hemisphere: "both", shape: { tag: "ellipse", cx: 290, cy: 230, rx: 40, ry: 28 },
    function: "Coordinates balance, posture, and fine motor control — the smoothness and precision of movement rather than initiating it.",
    facts: ["Despite being about 10% of the brain's volume, it contains over half of all the brain's neurons.", "\"Cerebellum\" is Latin for \"little brain.\"", "It's heavily involved in learning physical skills through repetition, like riding a bike."] },
  { id: "brainstem", name: "Brainstem", hemisphere: "center", shape: { tag: "rect", x: 210, y: 235, width: 22, height: 60, rx: 8 },
    function: "Controls the most basic life-sustaining functions: breathing, heart rate, blood pressure, and consciousness itself.",
    facts: ["It's the oldest part of the brain in evolutionary terms.", "Even in a persistent vegetative state, the brainstem often keeps basic functions running.", "It connects the brain directly to the spinal cord."] },
];

export const BRAIN_PARTS_CROSS_SECTION = [
  { id: "corpus-callosum", name: "Corpus Callosum", hemisphere: "center", shape: { tag: "path", d: "M100,120 C160,90 240,90 300,120", strokeOnly: true, strokeWidth: 10 },
    function: "A thick band of nerve fibers connecting the brain's left and right hemispheres, letting them share information.",
    facts: ["It contains roughly 200 million nerve fibers.", "Some rare people are born without one (agenesis of the corpus callosum) and the brain partly compensates.", "Cutting it (a historic epilepsy treatment) produces a \"split brain,\" studied extensively to understand hemisphere specialization."] },
  { id: "thalamus", name: "Thalamus", hemisphere: "center", shape: { tag: "ellipse", cx: 200, cy: 150, rx: 26, ry: 18 },
    function: "The brain's relay station — nearly all sensory information (except smell) passes through it on the way to the cortex.",
    facts: ["It's often called the brain's \"switchboard.\"", "It also plays a role in regulating consciousness, alertness, and sleep.", "It's split into two halves, one in each hemisphere, connected by a small bridge."] },
  { id: "hypothalamus", name: "Hypothalamus", hemisphere: "center", shape: { tag: "ellipse", cx: 195, cy: 180, rx: 14, ry: 10 },
    function: "Regulates body temperature, hunger, thirst, sleep cycles, and hormone release via the pituitary gland.",
    facts: ["It's about the size of an almond.", "It directly controls the pituitary gland, the body's master hormone gland.", "It's the brain's main link between the nervous system and the hormonal (endocrine) system."] },
  { id: "brainstem-cs", name: "Brainstem", hemisphere: "center", shape: { tag: "rect", x: 205, y: 210, width: 26, height: 75, rx: 10 },
    function: "Controls the most basic life-sustaining functions: breathing, heart rate, blood pressure, and consciousness itself.",
    facts: ["It's the oldest part of the brain in evolutionary terms.", "Even in a persistent vegetative state, the brainstem often keeps basic functions running.", "It connects the brain directly to the spinal cord."] },
  { id: "cerebellum-cs", name: "Cerebellum (cross-section)", hemisphere: "center", shape: { tag: "path", d: "M240,190 C280,185 310,210 305,245 C300,270 265,275 245,255 C230,235 230,200 240,190 Z" },
    function: "Coordinates balance, posture, and fine motor control — visible here in its characteristic branching, tree-like internal pattern.",
    facts: ["Its internal branching pattern is nicknamed the \"tree of life\" (arbor vitae) for its shape in cross-section.", "It has more folds packed into its surface than the rest of the brain combined.", "It processes sensory input from the inner ear to help maintain balance."] },
];
