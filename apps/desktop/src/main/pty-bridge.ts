// Python 标准库 PTY 转发程序；作为 TS 字符串随主进程打包，无额外运行时资源。
/** fd 0/1 保留原始终端字节，fd 3 独立传尺寸；有界非阻塞队列避免大段粘贴与回显互相堵住。 */
export const PTY_BRIDGE = String.raw`
import errno,fcntl,json,os,pty,select,struct,sys,termios

def resize(fd,cols,rows):
    fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',rows,cols,0,0))

ready_read,ready_write=os.pipe()
pid,master=pty.fork()
if pid==0:
    os.close(ready_read)
    os.close(3)
    resize(0,80,24)
    os.write(ready_write,b'1')
    os.close(ready_write)
    shell=os.environ.get('SHELL','/bin/zsh')
    os.execvp(shell,[shell,'-l'])

os.close(ready_write)
os.read(ready_read,1)
os.close(ready_read)
os.set_blocking(master,False)
os.set_blocking(1,False)
incoming=bytearray()
outgoing=bytearray()
control=b''
stdin_open=control_open=master_open=True
limit=65536
try:
    while master_open or outgoing:
        readers=([3] if control_open and master_open else [])
        if stdin_open and master_open and len(incoming)<limit: readers.append(0)
        if master_open and len(outgoing)<limit: readers.append(master)
        writers=([1] if outgoing else [])+([master] if master_open and incoming else [])
        readable,writable,_=select.select(readers,writers,[])
        # 同一批里先处理尺寸，再转发命令，避免 stty/tui 先读到旧行列。
        if 3 in readable:
            data=os.read(3,4096)
            if not data: control_open=False
            control+=data
            while b'\n' in control:
                line,control=control.split(b'\n',1)
                try:
                    size=json.loads(line)
                    cols,rows=size['cols'],size['rows']
                    if type(cols) is int and type(rows) is int and 0<cols<=65535 and 0<rows<=65535:
                        resize(master,cols,rows)
                except (ValueError,TypeError,KeyError): pass
            if len(control)>4096: control=b''
        if 0 in readable:
            data=os.read(0,min(8192,limit-len(incoming)))
            if data: incoming.extend(data)
            else: stdin_open=False
        if master in readable:
            try: data=os.read(master,min(8192,limit-len(outgoing)))
            except BlockingIOError: continue
            except OSError as error:
                if error.errno!=errno.EIO: raise
                data=b''
            if data: outgoing.extend(data)
            else:
                master_open=False
                incoming.clear()
        if 1 in writable:
            try: del outgoing[:os.write(1,outgoing)]
            except BlockingIOError: pass
        if master_open and master in writable:
            try: del incoming[:os.write(master,incoming)]
            except BlockingIOError: pass
            except OSError as error:
                if error.errno!=errno.EIO: raise
                master_open=False
                incoming.clear()
        if not stdin_open and not control_open: break
finally:
    os.close(master)
_,status=os.waitpid(pid,0)
sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 128+os.WTERMSIG(status))
`;
