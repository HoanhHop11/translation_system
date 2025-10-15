#!/bin/bash
# =============================================================================
# QUICK START - PHASE 1
# One-liner để bắt đầu Phase 1 deployment
# =============================================================================

cat << "EOF"
╔══════════════════════════════════════════════════════════════════════╗
║                     PHASE 1 - QUICK START                            ║
║              Infrastructure Setup - Auto Deployment                  ║
╚══════════════════════════════════════════════════════════════════════╝

🎯 MỤC TIÊU:
   ✓ Cài Docker trên 3 instances
   ✓ Setup Docker Swarm cluster
   ✓ Deploy PostgreSQL & Redis
   ✓ Configure networks & secrets

⏱️  THỜI GIAN: 30-60 phút (tự động)

📋 YÊU CẦU KIỂM TRA:
   ☐ File .env đã có đầy đủ thông tin
   ☐ SSH access vào 3 instances
   ☐ gcloud CLI đã config
   ☐ Firewall rules cho Docker Swarm

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 DEPLOYMENT COMMANDS:

1️⃣  KIỂM TRA TRƯỚC KHI BẮT ĐẦU:
   
   cd /home/hopboy2003/jbcalling_translation_realtime
   
   # Check .env
   grep -E "INSTANCE_|PASSWORD|SECRET|HF_TOKEN" .env | grep -v "^#"
   
   # Check SSH
   gcloud compute ssh translation01 --zone=asia-southeast1-a --command="hostname"
   gcloud compute ssh translation02 --zone=asia-southeast1-b --command="hostname"
   gcloud compute ssh translation03 --zone=asia-southeast1-b --command="hostname"

2️⃣  TẠO FIREWALL RULE (nếu chưa có):
   
   gcloud compute firewall-rules create docker-swarm-internal \
       --allow tcp:2377,tcp:7946,udp:7946,udp:4789 \
       --source-ranges 10.148.0.0/20 \
       --description "Docker Swarm internal communication"

3️⃣  CHẠY AUTO DEPLOYMENT:
   
   ./scripts/phase1/deploy-phase1.sh

   ⏳ Script sẽ chạy khoảng 30-60 phút
   📊 Theo dõi progress qua terminal output

4️⃣  VERIFY DEPLOYMENT:
   
   gcloud compute ssh translation01 --zone=asia-southeast1-a
   
   # Check nodes
   docker node ls
   
   # Check services
   docker service ls
   
   # Run verification
   ./verify-phase1.sh

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 EXPECTED RESULTS:

   Nodes:
   ✓ 3 nodes (1 manager + 2 workers)
   
   Networks:
   ✓ backend (overlay)
   ✓ frontend (overlay)
   ✓ monitoring (overlay)
   
   Services:
   ✓ postgres (1/1 replicas)
   ✓ redis (1/1 replicas)
   
   Secrets:
   ✓ 10+ secrets created

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🆘 TROUBLESHOOTING:

   Nếu có lỗi, check:
   
   1. Logs: docker service logs <service_name>
   2. Node status: docker node ls
   3. Service status: docker service ps <service_name>
   4. Firewall: gcloud compute firewall-rules list
   
   Common fixes:
   
   • SSH failed → gcloud compute config-ssh
   • Join failed → Check firewall rules
   • Service down → Check logs & constraints

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📚 DOCUMENTATION:

   • Full guide: docs/PHASE1-DEPLOYMENT.md
   • Manual steps: scripts/phase1/README.md
   • Troubleshooting: docs/10-TROUBLESHOOTING.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ COMPLETION CRITERIA:

   Phase 1 hoàn thành khi:
   
   ✓ verify-phase1.sh pass 100%
   ✓ Có thể connect vào PostgreSQL
   ✓ Có thể connect vào Redis
   ✓ Tất cả services ở trạng thái 1/1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 NEXT: Phase 2 - Core Services

╚══════════════════════════════════════════════════════════════════════╝
EOF

echo ""
read -p "Bạn muốn bắt đầu deployment ngay không? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🚀 Bắt đầu deployment..."
    cd /home/hopboy2003/jbcalling_translation_realtime
    ./scripts/phase1/deploy-phase1.sh
else
    echo "📝 Hãy chạy lại script này khi sẵn sàng!"
fi
