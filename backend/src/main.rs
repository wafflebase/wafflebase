use std::net::TcpListener;
use tungstenite::accept;

fn main() {
    let server = TcpListener::bind("127.0.0.1:8080").unwrap();

    for stream in server.incoming() {
        let stream = stream.unwrap();
        let addr = stream.peer_addr().unwrap();
        let mut websocket = accept(stream).unwrap();

        println!("Connection from {}", addr);

        loop {
            let msg = match websocket.read_message() {
                Ok(msg) => msg,
                Err(_) => {
                    println!("Connection closed from {}", addr);
                    break;
                },
            };

            if msg.is_text() || msg.is_binary() {
                websocket.write_message(msg).unwrap()
            }
        }
    }
}