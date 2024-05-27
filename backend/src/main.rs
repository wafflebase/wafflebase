use std::net::TcpListener;
use tungstenite::accept;

fn main() {
    let server = TcpListener::bind("127.0.0.1:9001").unwrap();
    println!("Server listening on port 9001");
    for stream in server.incoming() {
        let mut websocket = accept(stream.unwrap()).unwrap();
        loop {
            let msg = websocket.read_message().unwrap();
            websocket.write_message(msg).unwrap();
        }
    }
}