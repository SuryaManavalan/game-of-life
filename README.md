# Game of Life — README

## Run it
1. Open `index.html` in a modern browser.

## Use the UI
- **Start/Stop**: run or pause the simulation.  
- **Random**: seed ~30% of cells alive.  
- **Clear**: wipe board + stats.  
- **Paint/Erase**: click to toggle a cell, or click–drag to paint/erase.  
- **HUD (left panel)** shows:
  - Generation count  
  - Alive cells & density bar  
  - FPS (smoothed)  
  - Stability heuristic (Stable / Expanding / Decaying / Extinct)

## Pattern Overlay
When paused, any *known organisms* are detected (hover to match):
- **Still lifes**: Block, Beehive, Loaf, Boat, Tub  
- **Oscillators**: Blinker, Toad, Beacon, Pulsar, Penta-decathlon  
- **Spaceships**: Glider, LWSS, MWSS, HWSS  

Detected ones appear in an overlay list and their cells get outlined.

## Tweak the Engine
Inside `index.js`:
- **Grid size**: change `new GameOfLife(50)`  
- **Tick speed**: adjust `this.tickMs = 100` (ms per step)  
- **Random fill chance**: tweak `Math.random() < 0.3`  
- **Manual step (dev console)**:  
  ```js
  game.nextGeneration()
