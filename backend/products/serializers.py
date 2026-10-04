from rest_framework import serializers

from .models import Product
from stores.models import Store


class ProductSerializer(serializers.ModelSerializer):
    image = serializers.URLField(source='image_url', read_only=True, allow_blank=True)
    store_id = serializers.PrimaryKeyRelatedField(source='store', queryset=Store.objects.all(), write_only=True, required=False)

    class Meta:
        model = Product
        fields = ['id', 'store_id', 'name', 'category', 'price', 'description', 'image', 'image_url', 'stock_quantity', 'is_active', 'created_at', 'updated_at']
        read_only_fields = ['id', 'image', 'created_at', 'updated_at']

    def validate_store_id(self, store):
        request = self.context.get('request')
        if request is not None and store.owner_id != request.user.id:
            raise serializers.ValidationError('You can only manage products in your own stores.')
        return store

    def validate(self, attrs):
        if self.instance is None and 'store' not in attrs:
            raise serializers.ValidationError({'store_id': 'This field is required when creating a product.'})
        return attrs