class GameOfLife {
  constructor(size = 50) {
    this.size = size;
    this.grid = this.createGrid();
    this.isRunning = false;
    this.intervalId = null;
    this.gen = 0;
    this.lastAlive = 0;

    // fps estimator (EMA)
    this.lastTickAt = performance.now();
    this.fpsEma = 0; // exponential moving average
    this.tickMs = 100;

    // drag state
    this.isDragging = false;
    this.dragMode = null; // 'paint' or 'erase'
    this.dragStartTime = null;
    this.dragStartPos = null; // {row, col}

    // organism tracking state
    this.prevOrganisms = new Map(); // id -> {cells:Set("r,c"), centroid:[r,c], hue, color, lastSeenGen, velocity:[dr,dc]}
    this.nextOrganismId = 1;
    this.organismIdGrid = this.createIdGrid(); // per-cell organism id for coloring
    this.orgCount = 0;

    // pattern detection
    this.patternLib = this.buildPatternLibrary(); // name -> {class, period, speed, masks:Set<string>[]}
    this.detected = []; // [{name,class,period,speed, orgId, cells:[[r,c],...]}]

    this.init();
  }

  createGrid() {
    return Array.from({ length: this.size }, () => Array(this.size).fill(false));
  }
  createIdGrid() {
    return Array.from({ length: this.size }, () => Array(this.size).fill(0));
  }

  init() {
    // meta
    document.getElementById('metaGrid').textContent = `${this.size}×${this.size}`;
    document.getElementById('metaSpeed').textContent = `${Math.round(1000/this.tickMs)} Hz`;
    document.getElementById('tickOut').textContent = `${this.tickMs} ms`;
    document.getElementById('speedBar').style.width = `${Math.min(100, (1000/this.tickMs)/60*100)}%`;
    document.getElementById('grid').style.setProperty('--n', this.size);

    this.renderGrid();
    this.attachEventListeners();
    // compute organisms for the initial empty state
    this.computeOrganisms();
    this.updateHud(true); // initial
  }

  renderGrid() {
    const gridElement = document.getElementById('grid');
    gridElement.innerHTML = '';
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const cell = document.createElement('div');
        cell.className = `cell ${this.grid[r][c] ? 'alive' : 'dead'}`;
        cell.dataset.row = r;
        cell.dataset.col = c;

        // set organism tint variable
        cell.style.setProperty('--org', this.organismColorAt(r, c));

        // Mouse events for drag functionality
        cell.addEventListener('mousedown', (e) => this.handleMouseDown(e, r, c));
        cell.addEventListener('mouseenter', (e) => this.handleMouseEnter(e, r, c));
        cell.addEventListener('click', (e) => this.handleClick(e, r, c));

        gridElement.appendChild(cell);
      }
    }

    // Global mouse events
    document.addEventListener('mouseup', () => this.handleMouseUp());
    document.addEventListener('mouseleave', () => this.handleMouseUp());
  }

  paintCell(row, col) {
    // optional micro-optimization: update one cell instead of full re-render
    const gridElement = document.getElementById('grid');
    const idx = row * this.size + col;
    const el = gridElement.children[idx];
    el.className = `cell ${this.grid[row][col] ? 'alive' : 'dead'}`;
    el.style.setProperty('--org', this.organismColorAt(row, col));
  }

  toggleCell(row, col) {
    this.grid[row][col] = !this.grid[row][col];
    this.paintCell(row, col);
    this.recomputeAfterEdit();
  }

  setCellState(row, col, alive) {
    if (this.grid[row][col] !== alive) {
      this.grid[row][col] = alive;
      this.paintCell(row, col);
    }
  }

  handleMouseDown(e, row, col) {
    e.preventDefault();
    this.isDragging = false; // Start as not dragging
    this.dragStartTime = performance.now();
    this.dragStartPos = { row, col };

    // Determine what the drag mode would be based on current cell state
    const currentState = this.grid[row][col];
    this.dragMode = currentState ? 'erase' : 'paint';

    // Don't apply the action immediately - wait to see if it's a click or drag
  }

  handleMouseEnter(e, row, col) {
    // Only start dragging if we've moved to a different cell and mouse is down
    if (this.dragStartPos && (this.dragStartPos.row !== row || this.dragStartPos.col !== col)) {
      if (!this.isDragging) {
        // This is the start of a drag - apply action to the original cell
        this.isDragging = true;
        this.setCellState(this.dragStartPos.row, this.dragStartPos.col, this.dragMode === 'paint');
      }
      // Continue dragging to current cell
      this.setCellState(row, col, this.dragMode === 'paint');
    }
  }

  handleMouseUp() {
    if (this.isDragging) {
      this.isDragging = false;
      this.dragMode = null;
      this.dragStartPos = null;
      this.recomputeAfterEdit();
    } else if (this.dragStartPos) {
      // This was a click, not a drag
      this.toggleCell(this.dragStartPos.row, this.dragStartPos.col);
      this.dragStartPos = null;
      this.dragMode = null;
    }
  }

  handleClick(e, row, col) {
    // Click is now handled in handleMouseUp to avoid double-toggle
    // This method can remain empty or be removed
  }

  countNeighbors(row, col) {
    let count = 0;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        if (i === 0 && j === 0) continue;
        const r = row + i, c = col + j;
        if (r >= 0 && r < this.size && c >= 0 && c < this.size) {
          if (this.grid[r][c]) count++;
        }
      }
    }
    return count;
  }

  nextGeneration() {
    const next = this.createGrid();
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const n = this.countNeighbors(r, c);
        const alive = this.grid[r][c];
        next[r][c] = alive ? (n === 2 || n === 3) : (n === 3);
      }
    }
    this.grid = next;
    this.gen++;
    // organisms update
    this.computeOrganisms();
    this.redrawGridFast();
    this.updateHud();
  }

  redrawGridFast() {
    const gridElement = document.getElementById('grid');
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const idx = r * this.size + c;
        const el = gridElement.children[idx];
        el.className = `cell ${this.grid[r][c] ? 'alive' : 'dead'}`;
        el.style.setProperty('--org', this.organismColorAt(r, c));
      }
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    document.getElementById('startStopBtn').textContent = 'Stop';
    const badge = document.getElementById('runBadge');
    badge.classList.add('running');
    document.getElementById('runText').textContent = 'Running';

    this.lastTickAt = performance.now();
    this.intervalId = setInterval(() => {
      const now = performance.now();
      const dt = now - this.lastTickAt;
      this.lastTickAt = now;

      // EMA fps
      const fps = 1000 / dt;
      this.fpsEma = this.fpsEma ? this.fpsEma * 0.85 + fps * 0.15 : fps;

      this.nextGeneration();
    }, this.tickMs);

    this.clearOutlines();
    this.updatePatternOverlay();
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    clearInterval(this.intervalId);
    document.getElementById('startStopBtn').textContent = 'Start';
    const badge = document.getElementById('runBadge');
    badge.classList.remove('running');
    document.getElementById('runText').textContent = 'Idle';

    // Clear outlines and update overlay when stopping - outlines will appear on hover
    this.clearOutlines();
    this.updatePatternOverlay();
  }

  clear() {
    this.stop();
    this.grid = this.createGrid();
    this.gen = 0;
    this.prevOrganisms.clear();
    this.organismIdGrid = this.createIdGrid();
    this.orgCount = 0;
    this.redrawGridFast();
    this.updateHud(true);

    this.detected = [];
    this.clearOutlines();
    this.updatePatternOverlay();
  }

  randomize() {
    this.stop();
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        this.grid[r][c] = Math.random() < 0.3;
      }
    }
    this.gen = 0;
    this.computeOrganisms(true);
    this.redrawGridFast();
    this.updateHud(true);

    this.clearOutlines();
    this.updatePatternOverlay();
  }

  attachEventListeners() {
    document.getElementById('startStopBtn').addEventListener('click', () => this.isRunning ? this.stop() : this.start());
    document.getElementById('clearBtn').addEventListener('click', () => this.clear());
    document.getElementById('randomBtn').addEventListener('click', () => this.randomize());
  }

  aliveCount() {
    let a = 0;
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) if (this.grid[r][c]) a++;
    }
    return a;
  }

  updateHud(resetDelta = false) {
    const total = this.size * this.size;
    const alive = this.aliveCount();
    const density = alive / total;

    const delta = resetDelta ? 0 : (alive - this.lastAlive);
    this.lastAlive = alive;

    // stability signal (toy heuristic)
    const stability =
      density === 0 ? 'Extinct' :
      density === 1 ? 'Locked' :
      Math.abs(delta) < total * 0.005 ? 'Stable' :
      delta > 0 ? 'Expanding' : 'Decaying';

    // fill outputs
    document.getElementById('genOut').textContent = this.gen.toLocaleString();
    document.getElementById('aliveOut').textContent = alive.toLocaleString();
    document.getElementById('orgOut').textContent = this.orgCount.toLocaleString();
    document.getElementById('densityOut').textContent = density.toFixed(2);
    document.getElementById('fpsOut').textContent = (this.fpsEma || 0).toFixed(1);
    document.getElementById('aliveBar').style.width = `${(density*100).toFixed(1)}%`;
    document.getElementById('deltaOut').textContent = delta > 0 ? `+${delta}` : `${delta}`;
    document.getElementById('stabilityOut').textContent = stability;

    // color code stability
    const sEl = document.getElementById('stabilityOut');
    sEl.style.color =
      stability === 'Stable' ? 'var(--good)' :
      stability === 'Expanding' ? 'var(--accent)' :
      stability === 'Decaying' ? 'var(--warn)' :
      'var(--bad)';
  }

  // === Organism logic =====================================================

  // === Known Pattern Library ============================================
  buildPatternLibrary(){
    // Mask = set of "r,c" strings, anchored at (0,0)
    const S = (pts) => new Set(pts.map(([r,c])=>`${r},${c}`));

    // Helpers for transforms
    const norm = (pts) => {
      let minr=Infinity, minc=Infinity;
      for(const [r,c] of pts){ if(r<minr) minr=r; if(c<minc) minc=c; }
      return pts.map(([r,c])=>[r-minr, c-minc]);
    };
    const rot90 = (pts) => pts.map(([r,c])=>[c, -r]);
    const refl  = (pts) => pts.map(([r,c])=>[r, -c]); // reflect across vertical axis
    const uniqMasks = (pts0) => {
      // generate 8 symmetries, normalize each, dedupe
      const shapes = [];
      const pushU = (p) => {
        const n = norm(p);
        const k = n.map(([r,c])=>`${r},${c}`).sort().join('|');
        if(!shapes.some(x=>x.key===k)) shapes.push({key:k, set:S(n)});
      };
      let p = pts0;
      for(let i=0;i<4;i++){
        pushU(p);
        pushU(refl(p));
        p = rot90(p);
      }
      return shapes.map(x=>x.set);
    };

    // === Define canonical phase(s) for each pattern ===
    const patterns = [];

    // Still lifes (period 1, speed 0)
    patterns.push({ name:'Block', klass:'Still life', period:1, speed:'0',
      masks: uniqMasks([[0,0],[0,1],[1,0],[1,1]]) });

    patterns.push({ name:'Beehive', klass:'Still life', period:1, speed:'0',
      masks: uniqMasks([[0,1],[0,2],[1,0],[1,3],[2,1],[2,2]]) });

    patterns.push({ name:'Loaf', klass:'Still life', period:1, speed:'0',
      masks: uniqMasks([[0,1],[0,2],[1,0],[1,3],[2,1],[2,3],[3,2]]) });

    patterns.push({ name:'Boat', klass:'Still life', period:1, speed:'0',
      masks: uniqMasks([[0,0],[0,1],[1,0],[1,2],[2,1]]) });

    patterns.push({ name:'Tub', klass:'Still life', period:1, speed:'0',
      masks: uniqMasks([[0,1],[1,0],[1,2],[2,1]]) });

    // Oscillators
    // Blinker (both phases covered by symmetries)
    patterns.push({ name:'Blinker', klass:'Oscillator', period:2, speed:'0',
      masks: uniqMasks([[0,0],[0,1],[0,2]]) });

    // Toad
    patterns.push({ name:'Toad', klass:'Oscillator', period:2, speed:'0',
      masks: uniqMasks([[1,0],[1,1],[1,2],[0,1],[0,2],[0,3]]) });

    // Beacon
    patterns.push({ name:'Beacon', klass:'Oscillator', period:2, speed:'0',
      masks: uniqMasks([[0,0],[0,1],[1,0],[2,3],[3,2],[3,3]]) });

    // Pulsar (one phase; big 48 cells). Mask anchored upper-left of full bounding box.
    // Coordinates for classic 13x13 pulsar (phase shown):
    const pulsar = [
      [0,2],[0,3],[0,4],[0,8],[0,9],[0,10],
      [2,0],[2,5],[2,7],[2,12],
      [3,0],[3,5],[3,7],[3,12],
      [4,0],[4,5],[4,7],[4,12],
      [5,2],[5,3],[5,4],[5,8],[5,9],[5,10],
      [7,2],[7,3],[7,4],[7,8],[7,9],[7,10],
      [8,0],[8,5],[8,7],[8,12],
      [9,0],[9,5],[9,7],[9,12],
      [10,0],[10,5],[10,7],[10,12],
      [12,2],[12,3],[12,4],[12,8],[12,9],[12,10],
    ];
    patterns.push({ name:'Pulsar', klass:'Oscillator', period:3, speed:'0',
      masks: uniqMasks(pulsar) });

    // Penta-decathlon (one phase stick; we detect the bar of 10 with side nubs; simple phase)
    const p10 = [
      [0,1],
      [1,1],[1,0],[1,2],
      [2,1],
      [3,1],
      [4,1],[4,0],[4,2],
      [5,1],
      [6,1],
      [7,1],[7,0],[7,2],
      [8,1],
      [9,1]
    ];
    patterns.push({ name:'Penta-decathlon', klass:'Oscillator', period:15, speed:'0',
      masks: uniqMasks(p10) });

    // Spaceships (we match any single phase silhouette)
    // Glider phases: include a common phase; symmetries cover others well enough for detection
    patterns.push({ name:'Glider', klass:'Spaceship', period:4, speed:'c/4',
      masks: uniqMasks([[0,2],[1,0],[1,2],[2,1],[2,2]]) });

    // LWSS (one common phase, 5x4 box)
    const lwss = [
      [0,1],[0,4],
      [1,0],[2,0],
      [3,0],[3,1],[3,2],[3,3],[3,4],
      [2,4]
    ];
    patterns.push({ name:'Light-weight spaceship (LWSS)', klass:'Spaceship', period:4, speed:'c/2',
      masks: uniqMasks(lwss) });

    // MWSS
    const mwss = [
      [0,2],[0,3],
      [1,0],[1,4],
      [2,0],[2,5],
      [3,0],[3,1],[3,2],[3,3],[3,4],[3,5]
    ];
    patterns.push({ name:'Middle-weight spaceship (MWSS)', klass:'Spaceship', period:4, speed:'c/2',
      masks: uniqMasks(mwss) });

    // HWSS
    const hwss = [
      [0,2],[0,3],[0,4],
      [1,0],[1,5],
      [2,0],[2,6],
      [3,0],[3,1],[3,2],[3,3],[3,4],[3,5],[3,6]
    ];
    patterns.push({ name:'Heavy-weight spaceship (HWSS)', klass:'Spaceship', period:4, speed:'c/2',
      masks: uniqMasks(hwss) });

    // Convert to lookup by name if needed; keep as array for scan order
    return patterns;
  }

  // normalize a component's absolute cells to a zero-based shape-key
  normalizedKey(cells){
    let minr=Infinity, minc=Infinity;
    const pts = cells.map(([r,c])=>{ if(r<minr) minr=r; if(c<minc) minc=c; return [r,c]; });
    const rel = pts.map(([r,c])=>[r-minr, c-minc]).map(([r,c])=>`${r},${c}`).sort().join('|');
    return rel;
  }

  // Try to match a component against known masks
  matchPattern(comp){
    // comp.cells is [[r,c]...]
    // Fast path: compare sizes to prune
    const size = comp.cells.length;

    // Build set for quick membership (normalized)
    let minr=Infinity, minc=Infinity;
    for(const [r,c] of comp.cells){ if(r<minr) minr=r; if(c<minc) minc=c; }
    const relSet = new Set(comp.cells.map(([r,c])=>`${r-minr},${c-minc}`));

    for(const p of this.patternLib){
      // quick prune by mask size (all masks for a pattern share the same cell count)
      const sampleMask = p.masks[0];
      if(sampleMask.size !== size) continue;

      // check any symmetry mask
      for(const mask of p.masks){
        let all = true;
        for(const key of mask){ if(!relSet.has(key)){ all=false; break; } }
        if(all) return p; // matched
      }
    }
    return null;
  }

  clearOutlines(){
    const gridElement = document.getElementById('grid');
    for (let i=0;i<gridElement.children.length;i++){
      gridElement.children[i].classList.remove('outline');
    }
  }

  applyOutlinesForDetected(patternIndex = null){
    // outline the exact cells that belong to detected components
    // if patternIndex is provided, only outline that specific pattern
    const gridElement = document.getElementById('grid');
    const patternsToOutline = patternIndex !== null ? [this.detected[patternIndex]] : this.detected;
    
    for(const d of patternsToOutline){
      if(!d) continue; // safety check
      for(const [r,c] of d.cells){
        const idx = r * this.size + c;
        gridElement.children[idx]?.classList.add('outline');
      }
    }
  }

  updatePatternOverlay(){
    const overlay = document.getElementById('patternOverlay');
    const list = document.getElementById('patternList');
    if(!overlay || !list) return;

    // Only show overlay when paused
    if(this.isRunning || this.detected.length === 0){
      overlay.classList.add('hidden');
      list.innerHTML = '';
      return;
    }
    overlay.classList.remove('hidden');
    list.innerHTML = this.detected.map((d, index) => `
      <div class="pattern-card" data-pattern-index="${index}">
        <div>
          <div><strong>${d.name}</strong></div>
          <div class="meta">${d.klass} • period ${d.period}${d.speed !== '0' ? ` • speed ${d.speed}` : ''}</div>
        </div>
        <div class="pattern-tag">cells ${d.cells.length}</div>
      </div>
    `).join('');

    // Add hover event listeners for selective outlining
    this.attachPatternCardListeners();
  }

  attachPatternCardListeners(){
    const patternCards = document.querySelectorAll('.pattern-card');
    patternCards.forEach((card, index) => {
      card.addEventListener('mouseenter', () => {
        this.clearOutlines();
        this.applyOutlinesForDetected(index);
      });
      
      card.addEventListener('mouseleave', () => {
        this.clearOutlines();
        // Don't reapply any outlines on mouse leave - keep it clean
      });
    });
  }

  detectKnownPatternsFromComponents(components, assignments){
    // Build detected[] tied to persistent organism IDs when possible
    this.detected = [];
    for(const comp of components){
      const pat = this.matchPattern(comp);
      if(pat){
        const orgId = assignments.get(comp.tmpId) || 0;
        this.detected.push({
          name: pat.name,
          klass: pat.klass,
          period: pat.period,
          speed: pat.speed,
          orgId,
          cells: comp.cells
        });
      }
    }
  }

  recomputeAfterEdit() {
    // called after manual painting/erasing
    this.computeOrganisms();
    this.updateHud();
  }

  computeOrganisms(resetIds = false) {
    if (resetIds) {
      this.prevOrganisms.clear();
      this.nextOrganismId = 1;
    }

    // 1) label connected components (8-neighbors) of live cells
    const { components, idGrid } = this.labelComponents8();
    this.organismIdGrid = this.createIdGrid(); // will fill with persistent IDs
    this.orgCount = components.length;

    // 2) build current descriptors
    const cur = components.map(comp => {
      const cells = new Set(comp.cells.map(([r,c]) => `${r},${c}`));
      const centroid = this.centroid(comp.cells);
      const bbox = comp.bbox;
      return { cells, centroid, bbox, compId: comp.tmpId };
    });

    // 3) match to previous organisms allowing small translations (dx,dy in -1..1)
    const assignments = new Map(); // comp.tmpId -> organismId
    const usedPrev = new Set();

    for (const comp of cur) {
      let best = { score: 0, prevId: null, dx:0, dy:0 };
      for (const [prevId, prev] of this.prevOrganisms.entries()) {
        if (usedPrev.has(prevId)) continue;
        // try small translations to account for motion (gliders etc.)
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const overlap = this.overlapCount(comp.cells, prev.cells, dx, dy);
            if (overlap === 0) continue;
            const union = comp.cells.size + prev.cells.size - overlap;
            const iou = overlap / union;
            if (iou > best.score) best = { score: iou, prevId, dx, dy };
          }
        }
      }

      if (best.prevId !== null && best.score >= 0.20) { // reasonably similar
        assignments.set(comp.compId, best.prevId);
        usedPrev.add(best.prevId);
        // update descriptor
        const prev = this.prevOrganisms.get(best.prevId);
        const newVel = [
          comp.centroid[0] - prev.centroid[0],
          comp.centroid[1] - prev.centroid[1],
        ];
        this.prevOrganisms.set(best.prevId, {
          ...prev,
          cells: comp.cells,
          centroid: comp.centroid,
          lastSeenGen: this.gen,
          velocity: newVel,
        });
      }
    }

    // 4) assign IDs to unmatched current components (new organisms)
    for (const comp of cur) {
      if (!assignments.has(comp.compId)) {
        const id = this.nextOrganismId++;
        const hue = this.pickHueNearContrast(comp.centroid);
        const color = `hsl(${hue}deg 80% 55%)`;
        this.prevOrganisms.set(id, {
          cells: comp.cells,
          centroid: comp.centroid,
          hue,
          color,
          lastSeenGen: this.gen,
          velocity: [0,0],
        });
        assignments.set(comp.compId, id);
      }
    }

    // 5) drop stale previous organisms that don't exist anymore (they died/merged)
    const stillAlive = new Set(assignments.values());
    for (const [id, prev] of this.prevOrganisms.entries()) {
      if (prev.lastSeenGen !== this.gen && !stillAlive.has(id)) {
        this.prevOrganisms.delete(id);
      }
    }

    // 6) fill persistent organismIdGrid & tint cells
    for (const comp of components) {
      const orgId = assignments.get(comp.tmpId);
      for (const [r,c] of comp.cells) {
        this.organismIdGrid[r][c] = orgId;
      }
    }

    // 7) detect known patterns on current components
    this.detectKnownPatternsFromComponents(components, assignments);

    // Always clear outlines - they will only appear on hover when paused
    this.clearOutlines();
    this.updatePatternOverlay();
  }

  labelComponents8() {
    const visited = Array.from({ length: this.size }, () => Array(this.size).fill(false));
    const components = [];
    const idGrid = this.createIdGrid();
    let tmpId = 1;

    const dirs = [
      [-1,-1],[-1,0],[-1,1],
      [0,-1],        [0,1],
      [1,-1], [1,0], [1,1]
    ];

    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (!this.grid[r][c] || visited[r][c]) continue;
        const stack = [[r,c]];
        visited[r][c] = true;
        const cells = [];
        let minr=r, minc=c, maxr=r, maxc=c;

        while (stack.length) {
          const [cr, cc] = stack.pop();
          cells.push([cr, cc]);
          idGrid[cr][cc] = tmpId;
          minr = Math.min(minr, cr); minc = Math.min(minc, cc);
          maxr = Math.max(maxr, cr); maxc = Math.max(maxc, cc);

          for (const [dr, dc] of dirs) {
            const nr = cr + dr, nc = cc + dc;
            if (nr>=0 && nr<this.size && nc>=0 && nc<this.size &&
                this.grid[nr][nc] && !visited[nr][nc]) {
              visited[nr][nc] = true;
              stack.push([nr, nc]);
            }
          }
        }

        components.push({
          tmpId,
          cells,
          bbox: [minr,minc,maxr,maxc]
        });
        tmpId++;
      }
    }
    return { components, idGrid };
  }

  centroid(cells) {
    if (cells.length === 0) return [0,0];
    let sr = 0, sc = 0;
    for (const [r,c] of cells) { sr += r; sc += c; }
    return [sr / cells.length, sc / cells.length];
  }

  overlapCount(cellsA, cellsB, dx=0, dy=0) {
    // translate A by (dx,dy) and count overlaps with B
    let count = 0;
    for (const key of cellsA) {
      const [rStr,cStr] = key.split(',');
      const r = (rStr|0) + dx, c = (cStr|0) + dy;
      if (r<0 || r>=this.size || c<0 || c>=this.size) continue;
      if (cellsB.has(`${r},${c}`)) count++;
    }
    return count;
  }

  // Color picking: golden-angle hues; nudge to contrast with nearby organisms
  pickHueNearContrast(centroid) {
    const golden = 137.508;
    let baseHue = (this.nextOrganismId * golden) % 360;

    // find neighboring organisms within ~10 cells
    const nearby = [];
    for (const [, o] of this.prevOrganisms.entries()) {
      const d = Math.hypot(o.centroid[0] - centroid[0], o.centroid[1] - centroid[1]);
      if (d <= 10) nearby.push(o.hue);
    }
    if (nearby.length === 0) return baseHue;

    // simple repulsion: if too close in hue, push away
    for (const h of nearby) {
      const diff = this.hueDist(baseHue, h);
      if (diff < 50) {
        baseHue = (baseHue + (50 - diff)) % 360;
      }
    }
    return baseHue;
  }
  hueDist(a,b){
    const d = Math.abs(a-b) % 360;
    return d > 180 ? 360 - d : d;
  }

  organismColorAt(r, c) {
    const id = this.organismIdGrid[r][c];
    if (!id) return 'hsl(190deg 70% 50%)'; // default cyan-ish fallback
    const o = this.prevOrganisms.get(id);
    return o ? o.color : 'hsl(190deg 70% 50%)';
  }
}

// boot
const game = new GameOfLife(50);
console.log('Game of Life initialized with 50x50 grid.');
