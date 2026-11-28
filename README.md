# Island Flyer

A flight simulator that runs in your browser. Fly twelve real aircraft, from a Cessna to the Space Shuttle and a Black Hawk helicopter, over nine islands with twelve airports.

**Play it live: [flight-sim-ten-blue.vercel.app](https://flight-sim-ten-blue.vercel.app/)**

No download or sign-in. Fly with a keyboard, a PS5 controller, or touch sticks on a phone or tablet held sideways.

A friend has built a VR version of the game. Play it at [flight-sim-vr.vercel.app](https://flight-sim-vr.vercel.app/), and find its source at [jkugsiya/flight-sim-vr](https://github.com/jkugsiya/flight-sim-vr).

## What You Can Do

- **Fly free:** pick an aircraft and an airport, then start cold at the stand, lined up on the runway, or already in the air. Add a destination for a flight plan the autopilot can follow.
- **Refuel anywhere:** every airport has fuel trucks by its stands. Stop beside one with the parking brake set, and the tanks fill in about 20 seconds.
- **Fly over living cities:** five cities with their own look, skyscraper downtowns, traffic in the streets, and red beacons on the tall towers at night.
- **Take on missions:** 38 missions in eight groups, from step-by-step tutorials to dogfights, sea rescues, and a tower demolition.
- **Set the conditions:** calm, light, or strong wind. Clear, cloudy, rain, fog, or storm weather. Morning, noon, evening, or night.
- **Look around:** drag the mouse to circle the aircraft or turn your head in the cockpit, and lock the view on the runway for the turn onto final.
- **Take pictures:** photo mode freezes the flight, hides the panels, and gives you a free camera.

## The Aircraft

| Aircraft                  | Kind                 |
| ------------------------- | -------------------- |
| Cessna 172S Skyhawk       | Light trainer        |
| P-51D Mustang             | Piston fighter       |
| Airbus A320               | Narrow-body airliner |
| Boeing 737 MAX 8          | Narrow-body airliner |
| Boeing 787-9 Dreamliner   | Wide-body airliner   |
| Airbus A380               | Double-deck airliner |
| Concorde                  | Supersonic airliner  |
| F-22 Raptor               | Air combat fighter   |
| F-35A Lightning II        | Stealth fighter      |
| B-2 Spirit                | Stealth bomber       |
| Space Shuttle Orbiter     | Unpowered glider     |
| Sikorsky UH-60 Black Hawk | Helicopter           |

Each aircraft has its own engines, weight, speeds, and handling. Every one has a cockpit view and a chase view.

## Missions

| Group      | Missions | What you do                                                                                      |
| ---------- | -------- | ------------------------------------------------------------------------------------------------ |
| Tutorial   | 5        | Learn the controls, takeoff, landing, airliner startup, and the autopilot                        |
| Speed Run  | 4        | Race through rings against the clock, and down a city avenue on your side between towers         |
| Airline    | 2        | Fly passengers gate to gate on a flight plan                                                     |
| Challenge  | 11       | Land after engine fires, hydraulic failures, fuel leaks, storms, and fog                         |
| Bombing    | 4        | Drop bombs on a range and on targets from the B-2                                                |
| Strike     | 3        | Fire missiles and fly low under the radar                                                        |
| Air Combat | 5        | Dogfight, intercept, and escort a bomber against enemy fighters                                  |
| Helicopter | 4        | Land on a hospital roof, winch sailors off a boat, demolish a tower, and autorotate to a landing |

Each mission has a briefing and numbered steps. Landing missions also score your touchdown rate.

## Flight Model

The simulator works out the forces on the aircraft many times a second, in all six directions of motion. Wings lift and stall, engines spool up and burn fuel, and landing gear compresses on touchdown. Wind and gusts push the aircraft around.

The Black Hawk uses its own rotor model. It covers rotor speed, the ground cushion, extra lift as you pick up speed, and autorotation with the engines out. A stability system like the real helicopter's levels it and holds a hover when you let go of the keys.

The cockpit has working gauges, an autopilot with heading, navigation, level change, and vertical speed modes, approaches to every runway, with ILS at the larger airports, and ground proximity warnings.

## Controls

These are the main keys. The menu lists every control under **Controls**.

| Keys         | Plane                                                              | Helicopter                             |
| ------------ | ------------------------------------------------------------------ | -------------------------------------- |
| Arrow keys   | Pitch and roll                                                     | Tilt to fly forward, back, or sideways |
| W and S      | Throttle                                                           | Climb and descend                      |
| A and D      | Rudder                                                             | Turn on the spot                       |
| Q and E      | Trim                                                               | Set a speed to hold, down to a hover   |
| O, U, I      | Battery, fuel pumps, engines                                       | Battery, fuel pumps, engines           |
| F and V      | Flaps                                                              |                                        |
| G            | Landing gear                                                       |                                        |
| Z            | Autopilot                                                          | Autopilot                              |
| T            | Let the autopilot fly the approach                                 |                                        |
| C            | Chase or cockpit view                                              | Chase or cockpit view                  |
| Mouse drag   | Look around: circle the aircraft, or turn your head in the cockpit | Look around                            |
| Mouse wheel  | Zoom the view                                                      | Zoom the view                          |
| Double-click | Look ahead again                                                   | Look ahead again                       |
| /            | Keep the view on the runway                                        | Keep the view on the runway            |
| M            | Enlarge or hide the map                                            | Enlarge or hide the map                |
| Esc          | Pause                                                              | Pause                                  |

### PS5 Controller

Plug in or pair a DualSense, then press any button. It works in desktop and mobile browsers, and the touch controls hide while it is connected. The sticks work like a drone controller:

| Control         | Does                                                          |
| --------------- | ------------------------------------------------------------- |
| Left stick      | Throttle and rudder. In the helicopter, climb and turn        |
| Right stick     | Pitch and roll                                                |
| ✕               | Fire, or start and resume from the menus                      |
| ○               | Wheel brakes while held. In a fight, drop flares              |
| □ and △         | Landing gear, and chase or cockpit view                       |
| L1 and R1       | Flaps up and down                                             |
| L2 and R2       | Trim nose down and up                                         |
| L3 and R3       | Start every engine, and the autopilot                         |
| D-pad           | Look around while held                                        |
| Options         | Pause                                                         |

In Chrome and Edge the controller rumbles near a stall, with the afterburner lit, on touchdown, and in a crash.

### Touch Screens

Hold the phone or tablet sideways. The left stick works the throttle and rudder, and the right stick pitch and roll. Buttons beside the sticks change with the flight: **Start** switches on the battery, fuel pumps, and engines in one press. Drag anywhere else to look around. On phones, **Panel** shows the full instrument panel, and **Full Screen** hides the browser bars where the browser allows it.

## Run It Locally

You need [Bun](https://bun.sh/). Install the dependencies, then start the development server:

```sh
bun install
bun run dev
```

Vite prints a local address. Open it in your browser.

Other scripts:

```sh
bun run test       # flight model and mission tests
bun run typecheck  # TypeScript check
bun run check      # Biome lint and format
bun run build      # production build into dist/
```

## How It Is Built

- **React 19** and **TypeScript** for the menus and the instrument panel.
- **three.js** with **React Three Fiber** for the 3D world, drawn from code with no model files.
- **Vite** for development and builds, and **Tailwind CSS** for styling.
- **Bun** for packages and tests, and **Biome** for linting and formatting.

The source is in five folders:

| Folder      | Contents                                                      |
| ----------- | ------------------------------------------------------------- |
| `src/sim`   | The flight model and every aircraft's data                    |
| `src/world` | The islands, airports, approaches, scenery, and weather       |
| `src/game`  | The pilot's controls, autopilot, missions, sound, and effects |
| `src/scene` | The 3D world, aircraft models, and camera                     |
| `src/ui`    | The menu, the instrument panel, the map, and mission cards    |

The live site deploys to [Vercel](https://vercel.com/).
