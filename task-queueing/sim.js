//PIXI.settings.RESOLUTION = window.devicePixelRatio;

// Use this to guide color choices: https://blog.datawrapper.de/beautifulcolors/
const RED = 0xE56997;
const BLUE = 0x66D2D6;
const GREEN = 0x07BB9C;
const YELLOW = 0xFFD743;

var _globalId = 0;
function nextId() {
  return _globalId++;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

class Simulation extends PIXI.Application {
  constructor({
    element,
    queueOptions,
    serverOptions,
  }) {
    super({
      backgroundAlpha: 0,
      resizeTo: element,
    });

    this.runSimulation = false;
    this.agents = [];
    this.queues = [];
    this.servers = [];
    //this.debug = true;

    element.innerHTML = '';
    let container = document.createElement('div');
    element.appendChild(container);

    let uiContainer = document.createElement('div');
    uiContainer.style.position = 'absolute';

    let runSimulationContainer = document.createElement('div');
    let runSimulationButton = document.createElement('button');
    runSimulationButton.innerText = 'Run';
    runSimulationContainer.appendChild(runSimulationButton);
    runSimulationButton.addEventListener('click', () => {
      this.runSimulation = !this.runSimulation;
      if (this.runSimulation) {
        runSimulationButton.innerText = 'Pause';
        this.ticker.start();
      } else {
        runSimulationButton.innerText = 'Run';
        this.ticker.stop();
      }
    });
    uiContainer.appendChild(runSimulationContainer);

    container.appendChild(uiContainer);
    container.appendChild(this.view);


    const taskWidth = 40;
    const queueY = 50;
    const queuePadding = this.screen.width / 4
    const queueSpacing = (this.screen.width - 2 * queuePadding) / Math.max(1, queueOptions.length - 1);
    queueOptions.forEach((opts, i) => {
      const queue = new QueueBucket(this, {
        name: opts.name,
        x: queuePadding + (i * queueSpacing) - i * (taskWidth + 10),
        y: queueY,
        size: taskWidth + 10,
        color: opts.color,
        taskGenerator: opts.taskGenerator,
      });
      this.queues.push(queue);
    });

    this.thruPut = new ThruPutMeasure(this, {
      queues: this.queues,
      bottom: this.screen.height - this.screen.height * 0.1,
    });

    const pad = 10;
    const workerSize = taskWidth * 1.2;
    const serverSize = workerSize * 2 + pad * 4;
    const serverPadding = (this.screen.width - serverOptions.length * serverSize) / serverOptions.length + 1;
    const serverY = this.screen.height - (workerSize + 2 * pad) - this.screen.height * 0.3
    serverOptions.forEach((opts, i) => {
      const s = new Server(this, {
        x: 0.5 * serverPadding + (i * serverPadding) + i * serverSize,
        y: serverY,
        workerSize: workerSize,
        serverSize: serverSize,
        padding: pad,
        queues: this.queues.filter(q => opts.includes(q.name)),
        // TODO: set the queues from which this server may pick up from
      });
      this.servers.push(s);
    });


    this.ticker.add((delta) => this.update(delta));
  }

  add(agent) {
    this.stage.addChild(agent);
    this.agents.push(agent);
  }

  update(delta) {
    if (!this.runSimulation) {
      this.ticker.stop();
    }
    if (this.debug) {
      console.log(`[simulator] checking for agents to remove`);
    }
    var numAgentsRemoved = 0;
    for (let i = this.agents.length - 1; i >= 0; i--) {
      if (this.debug) {
        console.log(`[simulator] checking index ${i} (${this.agents[i].id})`);
      }
      if (this.agents[i].destroyed) {
        var removed = this.agents.splice(i, 1);
        numAgentsRemoved++;
        if (this.debug) {
          console.log(`[simulator] removed ${removed[0].id}`);
        }
      }
    }
    if (this.debug) {
      console.log(`[simulator] removed ${numAgentsRemoved} agents`);
    }

    if (this.debug) {
      console.log(`[simulator] update(${delta})`);
    }
    for (let agents of this.agents) {
      agents.update(delta);
    }
    if (this.debug) {
      console.log(`[simulator] done updating`);
    }
  }
}

class Agent extends PIXI.Graphics {
  constructor(simulation) {
    super();
    this.simulation = simulation;
    this.id = nextId();
    this.debug = false;
    this.simulation.add(this);
    this.onDestroyHooks = [];
  }

  update(delta) {
    if (this.debug) {
      console.log(`[${this.id}] update(${delta})`);
    }
  }

  destroy() {
    if (this.debug) {
      console.log(`[${this.id}] destroy()`);
    }
    for (let f of this.onDestroyHooks) {
      f();
    }
    super.destroy();
  }

  onDestroy(f) {
    this.onDestroyHooks.push(f);
  }
}

class Worker extends Agent {
  constructor(simulation, { x, y, size, color, server }) {
    super(simulation);
    this.x = x;
    this.y = y;
    this.server = server;
    this.currentTask = null;
    this.size = size;

    this.beginFill(this.server.color);
    this.drawRoundedRect(0, 0, size, size, 10);
    this.endFill();
  }

  get centerX() {
    return this.x + this.size / 2;
  }

  get centerY() {
    return this.y + this.size / 2;
  }

  assign(task) {
    this.currentTask = task;
    this.currentTask.worker = this;
    this.currentTask.inTransit = true;
  }

  update(delta) {
    super.update(delta);
    if (this.currentTask == null) {
      if (this.debug) {
        console.log(`[${this.id}] no current task`);
      }
      this.currentTask = this.server.queue.dequeue(this);
      if (this.currentTask == null) {
        if (this.debug) {
          console.log(`[${this.id}] no task to do`);
        }
        return;
      }
      if (this.debug) {
        console.log(`[${this.id}] got task ${this.currentTask.id}`);
      }
    }
    if (this.currentTask.duration - delta < 100) {
      if (this.debug) {
        console.log(`[${this.id}] task ${this.currentTask.id} done`);
      }
      this.currentTask.destroy();
      this.currentTask = null;
    }
  }
}

class Server extends Agent {
  constructor(simulation, { x, y, workerSize, serverSize, padding, queues }) {
    super(simulation);
    this.x = x;
    this.y = y;
    this.color = BLUE;
    this.myQueues = queues;
    this.currentQueue = 0;

    const height = workerSize + 2 * padding;

    this.beginFill(this.color, 0.3);
    this.lineStyle(1, this.color, 0.5, 0);
    this.drawRect(0, 0, serverSize, height);
    this.endFill();

    const workerPositions = [
      { x: this.x + padding, y: this.y + padding, size: workerSize, server: this },
      { x: this.x + 3 * padding + workerSize, y: this.y + padding, size: workerSize, server: this },
    ];

    this.workers = workerPositions.map(opts => new Worker(simulation, opts));
  }

  get queue() {
    const queue = this.myQueues[this.currentQueue];
    this.currentQueue = (this.currentQueue + 1) % this.myQueues.length;
    return queue;
  }
}


class ThruPutMeasure extends Agent {
  constructor(simulation, { queues, bottom }) {
    super(simulation);
    this.queues = queues;
    this.bottom = bottom;
    this.elapsedUpdates = 0;
    this.points = [];
    this.max = 0;
    this.all_measures = [];

    this.draw();

    const text_x = this.simulation.screen.width - 100;
    const text_y = bottom - 40;
    const font_config = { fontFamily: 'Monaco', fontSize: 14, fill: "#dae8dd", };
    // Display current thru put as a text integer
    this.currentValueText = new PIXI.Text(0, font_config);
    this.currentValueText.x = text_x;
    this.currentValueText.y = text_y - this.currentValueText.height;
    this.addChild(this.currentValueText);
    this.currentLabel = new PIXI.Text("Current", font_config);
    this.currentLabel.x = text_x + 20;
    this.currentLabel.y = this.currentValueText.y;
    this.addChild(this.currentLabel);

    // Display max thru put as a text integer
    this.maxValueText = new PIXI.Text(this.max, font_config);
    this.maxValueText.x = text_x;
    this.maxValueText.y = this.currentValueText.y - this.maxValueText.height;
    this.addChild(this.maxValueText);
    this.maxLabel = new PIXI.Text("Max", font_config);
    this.maxLabel.x = text_x + 20;
    this.maxLabel.y = this.maxValueText.y;
    this.addChild(this.maxLabel);
    
    // Display avg thru put as a text integer
    this.avgValueText = new PIXI.Text(0, font_config);
    this.avgValueText.x = text_x;
    this.avgValueText.y = this.maxValueText.y - this.avgValueText.height;
    this.addChild(this.avgValueText);
    this.avgLabel = new PIXI.Text("Average", font_config);
    this.avgLabel.x = text_x + 20;
    this.avgLabel.y = this.avgValueText.y;
    this.addChild(this.avgLabel);
  }

  yForIndex(index) {
    return this.bottom - 40 - this.points[this.points.length - index] * 4;
  }

  draw() {
    this.clear();
    this.lineStyle(1, "#fff", 0.5, 0);

    let currentX = this.simulation.screen.width - 100;
    this.moveTo(currentX, this.yForIndex(1));
    // start at 1 to skip the first point, setting the cursor to intial point above
    for (let i = 2; i < this.points.length; i++) {
      currentX -= this.simulation.screen.width / 10;
      this.lineTo(currentX, this.yForIndex(i));
    }

  }

  update(delta) {
    this.elapsedUpdates++;
    if (this.elapsedUpdates >= this.simulation.ticker.FPS) {
      let total = 0;
      for (let q of this.queues) {
        total += q.tasksPickedUp;
        q.tasksPickedUp = 0;
      }
      this.points.push(total);
      if (this.points.length > 10) {
        this.points.shift();
      }
      const sum = this.points.reduce((a, b) => a + b, 0);
      this.currentValueText.text = sum;
      if (sum > this.max) {
        this.max = sum;
        this.maxValueText.text = this.max;
      }
      this.all_measures.push(sum);
      this.avgValueText.text = Math.round(this.all_measures.reduce((a, b) => a + b, 0) / this.all_measures.length);
      this.elapsedUpdates = 0;
      this.draw();
    }
  }
}


class QueueBucket extends Agent {
  constructor(simulation, { name, x, y, size, color, taskGenerator }) {
    super(simulation);
    this.name = name;
    this.x = x;
    this.y = y;
    this.taskWidth = size - 10;
    this._width = size + 10;
    this._height = size * 3;
    this._color = color;
    this.taskGenerator = taskGenerator;
    this.tasks = [];
    this.tasksPickedUp = 0;
    this.elapsedUpdates = 0;
    this.centerX = this.x + this._width / 2;
    this.queueDurations = [];

    this.text = new PIXI.Text(
      this.name,
      { fontFamily: 'Monaco', fontSize: 14, fill: "#dae8dd", }
    );
    this.text.x = this._width / 2 - this.text.width / 2;
    this.text.y = - this.text.height - 15;
    this.addChild(this.text);

    this.avgQueueDuration = new PIXI.Text(
      "00",
      { fontFamily: 'Monaco', fontSize: 14, fill: "#dae8dd", }
    );
    this.avgQueueDuration.x = this._width / 2 - this.avgQueueDuration.width / 2;
    this.avgQueueDuration.y = - this.text.height;
    this.addChild(this.avgQueueDuration);

    this.beginFill(this._color, 0.3);
    this.lineStyle(1, this._color, 0.5, 0)
    this.drawRect(0, 0, this._width, this._height);
    this.endFill();
  }

  dequeue(worker) {
    let nextTask = this.tasks.shift();
    if (nextTask != null) {
      this.tasksPickedUp++;
    }
    if (nextTask == null) {
      return nextTask;
    }
    worker.assign(nextTask);
    this.queueDurations.push(nextTask.age);
    return nextTask;
  }

  fill() {
    if (this.tasks.length >= 100) {
      return;
    }
    const durations = this.taskGenerator.generate();
    const alreadyQueued = this.tasks.length;
    for (let i = 0; i < durations.length; i++) {
      this.tasks.push(new Task(this.simulation, {
        x: this.centerX,
        y: this.y + this._height - (i + alreadyQueued) * (this.taskWidth + 1),
        duration: durations[i],
        size: this.taskWidth,
        color: this._color,
      }));
    }

  }

  update(delta) {
    super.update(delta);

    this.elapsedUpdates++;
    if (this.elapsedUpdates >= this.simulation.ticker.FPS) {
      this.fill();
      this.elapsedUpdates = 0;
    }

    if (this.tasks.length == 0) {
      return;
    }

    let currentOffset = -this.tasks[0].height / 2;
    this.tasks.forEach(task => {
      if (task.height + currentOffset < this._height) {
        task.isVisibile = true;
        currentOffset += task.height / 2;
        task.y = this.y + this._height - currentOffset;
        currentOffset += task.height / 2;
      }
    });

    let averageQueueDuration = (this.queueDurations.reduce((a, b) => a + b, 0) / this.queueDurations.length) / 30;
    this.avgQueueDuration.text = Math.round(averageQueueDuration);
    if (this.queueDurations.length > 100) {
      this.queueDurations.shift();
    }
  }
}

const MAX_DURATION = 10000;

class Task extends Agent {
  constructor(simulation, { x, y, duration, size, color }) {
    super(simulation);
    this.x = x;
    this.y = y;
    this.initSize = size;
    this.duration = duration;
    this.color = color;
    //this._color = color;
    this.isVisibile = false;
    this.processing = false;
    this.inTransit = false;
    this.speed = 10;
    this.age = 0;
    this.draw();
  }
  
  get height() {
    const elapsedHeight = this.initSize * Math.min(this.duration, MAX_DURATION) / MAX_DURATION;
    return Math.max(elapsedHeight, 5);
  }

  get width() {
    return this.initSize;
  }

  get radius() {
    return this.height / 2;
  }

  draw() {
    if (this.destroyed) {
      return;
    }
    this.clear();
    if (!this.isVisibile) {
      return;
    }
    this.beginFill(this.color);
    this.drawCircle(0, 0, this.radius);
    this.endFill();
  }

  update(delta) {
    super.update(delta);
    if (this.destroyed) {
      return;
    }
    this.age += delta;
    if (this.processing) {
      this.duration = Math.max(this.duration - delta * 100, 100);
    }
    if (this.inTransit) {
      const dx = this.worker.centerX - this.x;
      const dy = this.worker.centerY - this.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < this.speed * delta) {
        this.x = this.worker.centerX;
        this.y = this.worker.centerY;
        this.processing = true;
        this.inTransit = false;
      } else {
        const rotation = Math.atan2(this.worker.centerY - this.y, this.worker.centerX - this.x);
        this.x += Math.cos(rotation) * this.speed * delta;
        this.y += Math.sin(rotation) * this.speed * delta;
      }
    }
    this.draw();
  }
}

class TaskGenerator {
  constructor(rates) {
    this.rates = rates
  }
  
  generate() {
    throw new Error("Not implemented");
  }
}

class InputTaskGenerator extends TaskGenerator {
  // rates is a list of [[rate, duration], ...]

  generate() {
    let generatedTaskDurations = [];
    for (let rate of this.rates) {
      if (Math.random() < rate[0]) {
        generatedTaskDurations.push(rate[1]);
      }
    }
  }
}

class RangedTaskGenerator extends TaskGenerator {
  // rates is a list of [[rate, count, min, max], ...]

  generate() {
    let generatedTaskDurations = [];
    for (let rate of this.rates) {
      //for (let i = 0; i < rate[1]; i++) {
        //if (Math.random() < rate[0]) {
          //generatedTaskDurations.push(randomInt(rate[2], rate[3]));
        //}
      //}
      for (let i = 0; i < 5; i++) {
        if (Math.random() < rate[0]) {
          generatedTaskDurations.push(randomInt(rate[2], rate[3]));
        }
      }
    }
    return generatedTaskDurations;
  }
}

document.addEventListener("DOMContentLoaded", function() {
  new Simulation({
    element: document.getElementById("slowQueue"),
    queueOptions: [
      {
        name: 'default',
        color: YELLOW,
        taskGenerator: new RangedTaskGenerator([
          [1, 1, 300, 10000],
          [0.5, 1, 100, 500],
        ]),
      },
      {
        name: 'slow',
        color: RED,
        taskGenerator: new RangedTaskGenerator([
          [0.1, 1, 10000, 50000],
        ]),
      },
    ],
    serverOptions: [
      ["default", "slow"],
      ["default", "slow"],
      ["default", "slow"],
      ["default", "slow"],
    ],
  });

  new Simulation({
    element: document.getElementById("fastQueue"),
    queueOptions: [
      {
        name: 'default',
        color: YELLOW,
        taskGenerator: new RangedTaskGenerator([
          [1, 4, 300, 10000],
          [0.1, 10, 10000, 50000],
        ]),
      },
      {
        name: 'fast',
        color: GREEN,
        taskGenerator: new RangedTaskGenerator([
          [0.5, 6, 100, 500],
        ]),
      },
    ],
    serverOptions: [
      ["default", "fast"],
      ["default", "fast"],
      ["default", "fast"],
      ["default", "fast"],
    ], 
  });

  new Simulation({
    element: document.getElementById("singleQueue"),
    queueOptions: [
      {
        name: 'default',
        color: YELLOW,
        taskGenerator: new RangedTaskGenerator([
          [1, 4, 300, 10000],
          [0.1, 10, 10000, 50000],
          [0.5, 6, 100, 500],
        ]),
      },
    ],
    serverOptions: [
      ["default",],
      ["default",],
      ["default",],
      ["default",],
    ], 
  });

  new Simulation({
    element: document.getElementById("dedicatedQueueSlow"),
    queueOptions: [
      {
        name: 'default',
        color: YELLOW,
        taskGenerator: new RangedTaskGenerator([
          [1, 4, 300, 10000],
          [0.5, 6, 100, 500],
        ]),
      },
      {
        name: 'slow',
        color: RED,
        taskGenerator: new RangedTaskGenerator([
          [0.1, 10, 10000, 50000],
        ]),
      },
    ],
    serverOptions: [
      ["default",],
      ["default",],
      ["default",],
      ["slow",],
    ], 
  });

  new Simulation({
    element: document.getElementById("dedicatedQueueFast"),
    queueOptions: [
      {
        name: 'default',
        color: YELLOW,
        taskGenerator: new RangedTaskGenerator([
          [1, 4, 300, 10000],
          [0.1, 10, 10000, 50000],
          [0.5, 6, 100, 500],
        ]),
      },
      {
        name: 'fast',
        color: GREEN,
        taskGenerator: new RangedTaskGenerator([
          [0.5, 6, 100, 500],
        ]),
      },
    ],
    serverOptions: [
      ["default",],
      ["default",],
      ["default",],
      ["fast",],
    ], 
  });

  new Simulation({
    element: document.getElementById("halfNHalfQueue"),
    queueOptions: [
      {
        name: 'default',
        color: YELLOW,
        taskGenerator: new RangedTaskGenerator([
          [1, 4, 300, 10000],
          [0.5, 6, 100, 500],
        ]),
      },
      {
        name: 'slow',
        color: RED,
        taskGenerator: new RangedTaskGenerator([
          [0.1, 10, 10000, 50000],
        ]),
      },
    ],
    serverOptions: [
      ["default",],
      ["default",],
      ["default", "slow"],
      ["default", "slow"],
    ], 
  });
});
