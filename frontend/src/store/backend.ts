export async function createBackendStore(_: string): Promise<BackendStore> {
  return new BackendStore();
}

class BackendStore {
  socket: WebSocket;

  constructor() {
    this.socket = new WebSocket('ws://127.0.0.1:8080');

    this.socket.onopen = () => {
      this.socket.send('Hello Server!');
    };

    this.socket.onmessage = (event) => {
      console.log('Server says: ' + event.data);
    };

    this.socket.onclose = (event) => {
      console.log('Socket closed connection: ', event);
    };

    this.socket.onerror = (error) => {
      console.log('Socket Error: ', error);
    };
  }

  public async close() {
    this.socket.close();
  }
}
